import type {
  AnalysisTile,
  DeduplicatedPanel,
  RawTileSegment,
  SourceImage,
  TileAnalysisResult,
} from './types';

export const DEFAULT_TILE_HEIGHT_PX = 2400;
export const DEFAULT_TILE_OVERLAP_PX = 360;

// 매직 바이트 시그니처 검증: JPEG, PNG, WEBP만 허용하고 위조된 확장자 거부 (T16)
export function verifyImageMagicBytes(buffer: Buffer): {
  valid: boolean;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  reason?: string;
} {
  if (!buffer || buffer.byteLength < 12) {
    return { valid: false, reason: 'File is too small to be a valid image (< 12 bytes).' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, mimeType: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, mimeType: 'image/png' };
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { valid: true, mimeType: 'image/webp' };
  }

  return {
    valid: false,
    reason: 'Unsupported magic-byte signature. Only JPEG, PNG, and WEBP are allowed.',
  };
}

// 다중 스트립 이미지를 전역 Y좌표(globalYStart..globalYEnd)로 연결하고 오버랩 타일 생성 (T01)
export function buildAnalysisTilesFromStrips(
  episodeId: string,
  revisionId: string,
  sourceImages: SourceImage[],
  options?: { tileHeightPx?: number; overlapPx?: number },
): AnalysisTile[] {
  if (sourceImages.length === 0) {
    return [];
  }

  const sorted = [...sourceImages].sort((a, b) => a.orderIndex - b.orderIndex);
  const totalHeight = sorted[sorted.length - 1].globalYEnd;
  const maxWidth = sorted.reduce((acc, s) => Math.max(acc, s.width), 690);

  const tileHeightPx = options?.tileHeightPx ?? DEFAULT_TILE_HEIGHT_PX;
  const overlapPx = options?.overlapPx ?? DEFAULT_TILE_OVERLAP_PX;
  const stridePx = Math.max(400, tileHeightPx - overlapPx);

  const tiles: AnalysisTile[] = [];
  let yCursor = 0;
  let tileIndex = 0;

  while (yCursor < totalHeight) {
    const globalYStart = yCursor;
    const globalYEnd = Math.min(totalHeight, globalYStart + tileHeightPx);
    const height = globalYEnd - globalYStart;

    const overlappingStrips = sorted.filter(
      (s) => s.globalYEnd > globalYStart && s.globalYStart < globalYEnd,
    );

    const overlapTopPx = tileIndex === 0 ? 0 : overlapPx;
    const overlapBottomPx = globalYEnd >= totalHeight ? 0 : overlapPx;
    const tileId = `tile_${String(tileIndex + 1).padStart(3, '0')}`;

    tiles.push({
      tileId,
      episodeId,
      revisionId,
      tileIndex,
      globalYStart,
      globalYEnd,
      overlapTopPx,
      overlapBottomPx,
      width: maxWidth,
      height,
      sourceImageIds: overlappingStrips.map((s) => s.sourceImageId),
      storageUri: '',
      status: 'pending',
    });

    tileIndex += 1;
    if (globalYEnd >= totalHeight) {
      break;
    }
    yCursor += stridePx;
  }

  return tiles;
}

// 스트립 전역 좌표 연속성 및 타일 커버리지 무결성 검증
export function verifyCoordinateCoverage(
  sourceImages: SourceImage[],
  tiles: AnalysisTile[],
): {
  valid: boolean;
  errors: string[];
  totalStitchedHeight: number;
} {
  const errors: string[] = [];
  if (sourceImages.length === 0) {
    return { valid: false, errors: ['No source images provided.'], totalStitchedHeight: 0 };
  }

  const sortedStrips = [...sourceImages].sort((a, b) => a.orderIndex - b.orderIndex);
  let expectedY = 0;
  for (const strip of sortedStrips) {
    if (strip.globalYStart !== expectedY) {
      errors.push(
        `Strip ${strip.sourceImageId} starts at ${strip.globalYStart}, expected ${expectedY}.`,
      );
    }
    if (strip.globalYEnd - strip.globalYStart !== strip.height) {
      errors.push(`Strip ${strip.sourceImageId} height mismatch.`);
    }
    expectedY = strip.globalYEnd;
  }

  const totalHeight = expectedY;
  if (tiles.length === 0) {
    errors.push('No analysis tiles generated.');
    return { valid: false, errors, totalStitchedHeight: totalHeight };
  }

  const sortedTiles = [...tiles].sort((a, b) => a.tileIndex - b.tileIndex);
  if (sortedTiles[0].globalYStart !== 0) {
    errors.push(`First tile starts at ${sortedTiles[0].globalYStart}, expected 0.`);
  }
  if (sortedTiles[sortedTiles.length - 1].globalYEnd !== totalHeight) {
    errors.push(
      `Last tile ends at ${sortedTiles[sortedTiles.length - 1].globalYEnd}, expected ${totalHeight}.`,
    );
  }

  for (let i = 1; i < sortedTiles.length; i++) {
    const prev = sortedTiles[i - 1];
    const curr = sortedTiles[i];
    if (curr.globalYStart > prev.globalYEnd) {
      errors.push(
        `Uncovered gap between tile ${prev.tileId} (${prev.globalYEnd}) and ${curr.tileId} (${curr.globalYStart}).`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    totalStitchedHeight: totalHeight,
  };
}

function normalizeTextForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,!?~"''“”‘’()[\]{}\-—…·:;/\\]+/g, '')
    .trim();
}

function textSimilarity(a: string, b: string): number {
  const na = normalizeTextForDedup(a);
  const nb = normalizeTextForDedup(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const setA = new Set(na.split(''));
  const setB = new Set(nb.split(''));
  let inter = 0;
  for (const ch of setA) {
    if (setB.has(ch)) inter += 1;
  }
  return inter / Math.max(setA.size, setB.size, 1);
}

function verticalIoU(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const interStart = Math.max(aStart, bStart);
  const interEnd = Math.min(aEnd, bEnd);
  const inter = Math.max(0, interEnd - interStart);
  if (inter <= 0) return 0;
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart);
  return union > 0 ? inter / union : 0;
}

// 오버랩 구간의 중복 패널 및 세그먼트 병합/제거 (T02)
export function mergeAndDeduplicateTileResults(
  completedTiles: Array<{ tile: AnalysisTile; result: TileAnalysisResult }>,
): DeduplicatedPanel[] {
  const sortedTiles = [...completedTiles].sort((a, b) => a.tile.tileIndex - b.tile.tileIndex);
  const mergedPanels: DeduplicatedPanel[] = [];

  for (const { tile, result } of sortedTiles) {
    const rawPanels = [...(result.panels ?? [])].sort(
      (a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || a.localPanelIndex - b.localPanelIndex,
    );

    for (const rp of rawPanels) {
      // bbox.y, bbox.height가 0..1000 정규화 값인지 로컬 픽셀 값인지 자동 판별
      const isNormalized = rp.bbox.y <= 1000 && rp.bbox.height <= 1000 && tile.height > 1000;
      const localY = isNormalized
        ? Math.round((rp.bbox.y / 1000) * tile.height)
        : Math.round(rp.bbox.y);
      const localH = isNormalized
        ? Math.max(120, Math.round((rp.bbox.height / 1000) * tile.height))
        : Math.max(120, Math.round(rp.bbox.height));

      const globalYStart = Math.min(
        tile.globalYEnd - 40,
        Math.max(tile.globalYStart, tile.globalYStart + localY),
      );
      const globalYEnd = Math.min(tile.globalYEnd, Math.max(globalYStart + 80, globalYStart + localH));

      const candidate: DeduplicatedPanel = {
        sourceTileIndex: tile.tileIndex,
        globalYStart,
        globalYEnd,
        bbox: {
          x: rp.bbox.x ?? 0,
          y: localY,
          width: rp.bbox.width || tile.width,
          height: globalYEnd - globalYStart,
        },
        visualSummaryKo: rp.visualSummaryKo.trim(),
        visualSummaryEn: rp.visualSummaryEn.trim(),
        emotionalToneKo: rp.emotionalToneKo.trim() || '긴장감 있는 연출',
        emotionalToneEn: rp.emotionalToneEn.trim() || 'Dramatic tension',
        continuityNote: rp.continuityNote.trim(),
        segments: (rp.segments ?? []).filter((s) => s.textKo.trim().length > 0),
      };

      // 직전 패널들과 오버랩 구간 중복 여부 확인
      let duplicateTarget: DeduplicatedPanel | undefined;
      for (let i = Math.max(0, mergedPanels.length - 4); i < mergedPanels.length; i++) {
        const existing = mergedPanels[i];
        const vIoU = verticalIoU(
          existing.globalYStart,
          existing.globalYEnd,
          candidate.globalYStart,
          candidate.globalYEnd,
        );
        const centerDist = Math.abs(
          (existing.globalYStart + existing.globalYEnd) / 2 -
            (candidate.globalYStart + candidate.globalYEnd) / 2,
        );
        const summarySim = textSimilarity(existing.visualSummaryKo, candidate.visualSummaryKo);

        const existingDialogText = existing.segments.map((s) => s.textKo).join(' ');
        const candidateDialogText = candidate.segments.map((s) => s.textKo).join(' ');
        const dialogSim = textSimilarity(existingDialogText, candidateDialogText);

        if (
          (vIoU >= 0.42 && (summarySim >= 0.55 || dialogSim >= 0.65)) ||
          (centerDist <= 280 && (summarySim >= 0.72 || dialogSim >= 0.78))
        ) {
          duplicateTarget = existing;
          break;
        }
      }

      if (duplicateTarget) {
        // 더 상세한 시각 요약 유지 및 누락된 고유 대사만 병합
        if (candidate.visualSummaryKo.length > duplicateTarget.visualSummaryKo.length) {
          duplicateTarget.visualSummaryKo = candidate.visualSummaryKo;
          duplicateTarget.visualSummaryEn = candidate.visualSummaryEn;
        }
        duplicateTarget.globalYStart = Math.min(
          duplicateTarget.globalYStart,
          candidate.globalYStart,
        );
        duplicateTarget.globalYEnd = Math.max(duplicateTarget.globalYEnd, candidate.globalYEnd);

        const mergedSegs: RawTileSegment[] = [...duplicateTarget.segments];
        for (const candSeg of candidate.segments) {
          const alreadyExists = mergedSegs.some(
            (es) =>
              es.kind === candSeg.kind && textSimilarity(es.textKo, candSeg.textKo) >= 0.8,
          );
          if (!alreadyExists) {
            mergedSegs.push(candSeg);
          }
        }
        duplicateTarget.segments = mergedSegs;
      } else {
        // 패널 내부에서도 중복된 세그먼트 제거
        const uniqueSegs: RawTileSegment[] = [];
        for (const seg of candidate.segments) {
          const isDup = uniqueSegs.some(
            (u) => u.kind === seg.kind && textSimilarity(u.textKo, seg.textKo) >= 0.85,
          );
          if (!isDup) {
            uniqueSegs.push(seg);
          }
        }
        candidate.segments = uniqueSegs;
        mergedPanels.push(candidate);
      }
    }
  }

  return mergedPanels.sort((a, b) => a.globalYStart - b.globalYStart);
}
