import crypto from 'node:crypto';
import type {
  AudioAsset,
  Episode,
  LocaleCode,
  Panel,
  PublishMode,
  Revision,
  Segment,
  SoundCue,
  SourceImage,
  TileAnalysisResult,
  ValidationReport,
} from './types';
import {
  buildAnalysisTilesFromStrips,
  mergeAndDeduplicateTileResults,
  verifyCoordinateCoverage,
  verifyImageMagicBytes,
} from './tiling';
import { reconcileEpisodeCast } from './cast';
import {
  ENSURED_SOUND_LIBRARY,
  ensureSoundLibraryLoaded,
  resolveSoundEffectAsset,
} from './sound-library';
import {
  buildPlaybackManifestForLocale,
  computeSegmentAudioInputHash,
  repairRecoverableValidationIssuesOnce,
  validateRevisionForPublish,
} from './validation';
import { analyzeTileWithGemini, synthesizeSegmentTtsWithGemini } from './gemini';
import {
  getEpisode,
  getRevision,
  publishRevisionAtomically,
  readBinaryAsset,
  recordAudioAssetWithInputHashGuard,
  saveEpisode,
  saveManifest,
  saveRevision,
  storeBinaryAsset,
} from './store';
import { claimTaskLease, completeTask, enqueueIdempotentTask } from './tasks';
import sharp, { type OverlayOptions } from 'sharp';

export interface UploadedManuscriptFile {
  filename: string;
  buffer: Buffer;
}

export async function createEpisodeWithManuscript(params: {
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  authorName: string;
  publishMode: PublishMode;
  files: UploadedManuscriptFile[];
  episodeId?: string;
}): Promise<{ episode: Episode; revision: Revision }> {
  if (params.files.length === 0) {
    throw new Error('최소 1개 이상의 원고 이미지가 필요합니다.');
  }

  const now = new Date().toISOString();
  const episodeId =
    params.episodeId ||
    `ep_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const revisionId = `rev_${ episodeId }_v1`;

  const sourceImages: SourceImage[] = [];
  let cumulativeYOffset = 0;
  let maxWidth = 0;

  // 파일명 자연 정렬 (01.jpg, 02.jpg ... 60.jpg)
  const sortedFiles = [...params.files].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }),
  );

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const magicCheck = verifyImageMagicBytes(file.buffer);
    if (!magicCheck.valid || !magicCheck.mimeType) {
      throw new Error(
        `Invalid image signature for "${file.filename}": ${magicCheck.reason ?? 'unknown format'}`,
      );
    }

    const metadata = await sharp(file.buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid dimensions for "${file.filename}"`);
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const sourceImageId = `src_${String(i + 1).padStart(3, '0')}`;
    const ext =
      magicCheck.mimeType === 'image/png'
        ? 'png'
        : magicCheck.mimeType === 'image/webp'
          ? 'webp'
          : 'jpg';
    const relativeKey = `episodes/${episodeId}/${revisionId}/sources/${sourceImageId}.${ext}`;
    const storageUri = await storeBinaryAsset(relativeKey, file.buffer, magicCheck.mimeType);

    sourceImages.push({
      sourceImageId,
      episodeId,
      revisionId,
      orderIndex: i,
      filename: file.filename,
      mimeType: magicCheck.mimeType,
      byteSize: file.buffer.byteLength,
      sha256,
      width,
      height,
      globalYStart: cumulativeYOffset,
      globalYEnd: cumulativeYOffset + height,
      storageUri,
    });

    cumulativeYOffset += height;
    if (width > maxWidth) {
      maxWidth = width;
    }
  }

  // 타일 생성 및 스플라이스된 타일 이미지 저장
  const rawTiles = buildAnalysisTilesFromStrips(episodeId, revisionId, sourceImages);
  const coverage = verifyCoordinateCoverage(sourceImages, rawTiles);
  if (!coverage.valid) {
    throw new Error(`Coordinate coverage error: ${coverage.errors.join('; ')}`);
  }

  // 각 타일에 해당하는 합성 이미지 버퍼 생성 후 저장
  for (const tile of rawTiles) {
    const overlappingSources = sourceImages.filter(
      (src) => src.globalYEnd > tile.globalYStart && src.globalYStart < tile.globalYEnd,
    );

    const compositeInputs: OverlayOptions[] = [];
    for (const src of overlappingSources) {
      const srcBuf = await readBinaryAsset(src.storageUri);
      const cropTop = Math.max(0, tile.globalYStart - src.globalYStart);
      const cropBottom = Math.min(src.height, tile.globalYEnd - src.globalYStart);
      const cropHeight = cropBottom - cropTop;
      if (cropHeight <= 0) continue;

      const croppedBuf = await sharp(srcBuf)
        .extract({
          left: 0,
          top: cropTop,
          width: src.width,
          height: cropHeight,
        })
        .jpeg({ quality: 88 })
        .toBuffer();

      const destTop = Math.max(0, src.globalYStart - tile.globalYStart);
      compositeInputs.push({
        input: croppedBuf,
        top: destTop,
        left: 0,
      });
    }

    const tileBuffer = await sharp({
      create: {
        width: tile.width,
        height: tile.height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(compositeInputs)
      .jpeg({ quality: 88 })
      .toBuffer();

    const tileKey = `episodes/${episodeId}/${revisionId}/tiles/${tile.tileId}.jpg`;
    tile.storageUri = await storeBinaryAsset(tileKey, tileBuffer, 'image/jpeg');
  }

  await ensureSoundLibraryLoaded();

  const episode: Episode = {
    episodeId,
    titleKo: params.titleKo,
    titleEn: params.titleEn,
    summaryKo: params.summaryKo,
    summaryEn: params.summaryEn,
    authorName: params.authorName,
    activeDraftRevisionId: revisionId,
    publishMode: params.publishMode,
    status: 'ingesting',
    totalStitchedWidth: maxWidth,
    totalStitchedHeight: cumulativeYOffset,
    sourceImageCount: sourceImages.length,
    panelCount: 0,
    characterCount: 0,
    voicePoolExhausted: false,
    coverImageAssetId: sourceImages[0]?.sourceImageId,
    createdAt: now,
    updatedAt: now,
  };

  const revision: Revision = {
    revisionId,
    episodeId,
    revisionNumber: 1,
    status: 'ingesting',
    publishMode: params.publishMode,
    sourceImages,
    tiles: rawTiles,
    panels: [],
    segments: [],
    characters: [],
    soundCues: [],
    audioAssets: [],
    manifests: {},
    voicePoolExhausted: false,
    autoCorrectionApplied: false,
    createdAt: now,
    updatedAt: now,
  };

  await saveEpisode(episode);
  await saveRevision(revision);
  return { episode, revision };
}

// 타일 분석 및 전체 대본/캐릭터/효과음 구성
export async function analyzeEpisodeRevisionTiles(params: {
  episodeId: string;
  revisionId: string;
  maxTilesToAnalyze?: number;
  tileAnalyzerOverride?: (
    tileIndex: number,
    totalTiles: number,
    tileBuffer: Buffer,
  ) => Promise<{ result: TileAnalysisResult; latencyMs: number; modelId: string }>;
}): Promise<{ episode: Episode; revision: Revision }> {
  const episode = await getEpisode(params.episodeId);
  const revision = await getRevision(params.episodeId, params.revisionId);
  if (!episode || !revision) {
    throw new Error(`Episode or revision not found: ${params.episodeId}/${params.revisionId}`);
  }

  episode.status = 'analyzing';
  revision.status = 'analyzing';
  episode.updatedAt = new Date().toISOString();
  revision.updatedAt = episode.updatedAt;
  await saveEpisode(episode);
  await saveRevision(revision);

  const tilesToRun =
    typeof params.maxTilesToAnalyze === 'number'
      ? revision.tiles.slice(0, params.maxTilesToAnalyze)
      : revision.tiles;

  for (const tile of tilesToRun) {
    if (tile.status === 'completed' && tile.rawResult) {
      continue;
    }

    const { task } = await enqueueIdempotentTask({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      taskType: 'tile_analysis',
      idempotencyKeyParts: [tile.tileId],
      payload: { tileId: tile.tileId, tileIndex: tile.tileIndex },
    });

    const leased = await claimTaskLease(task);
    const activeTask = leased ?? task;

    try {
      tile.status = 'analyzing';
      const tileBuffer = await readBinaryAsset(tile.storageUri);
      const analyzer = params.tileAnalyzerOverride
        ? () => params.tileAnalyzerOverride!(tile.tileIndex, revision.tiles.length, tileBuffer)
        : () =>
            analyzeTileWithGemini({
              tileBuffer,
              mimeType: 'image/jpeg',
              tileIndex: tile.tileIndex,
              totalTiles: revision.tiles.length,
              episodeTitleKo: episode.titleKo,
            });

      const { result } = await analyzer();
      tile.rawResult = result;
      tile.status = 'completed';
      await completeTask(activeTask, 'succeeded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tile.status = 'failed';
      await completeTask(activeTask, 'failed', msg);
      throw err;
    }
  }

  // 분석된 타일 결과 병합 및 중복 제거
  const completedTiles = revision.tiles
    .filter((t) => t.status === 'completed' && t.rawResult)
    .map((t) => ({ tile: t, result: t.rawResult! }));

  const deduplicatedPanels = mergeAndDeduplicateTileResults(completedTiles);
  const castOutcome = reconcileEpisodeCast({
    episodeId: episode.episodeId,
    revisionId: revision.revisionId,
    panels: deduplicatedPanels,
    existingCharacters: revision.characters,
  });

  const panels: Panel[] = [];
  const segments: Segment[] = [];
  const soundCues: SoundCue[] = [];
  let globalSegmentOrder = 0;

  for (let pIdx = 0; pIdx < deduplicatedPanels.length; pIdx++) {
    const dp = deduplicatedPanels[pIdx];
    const panelId = `panel_${String(pIdx + 1).padStart(3, '0')}`;
    const sourceTile =
      revision.tiles.find((t) => t.tileIndex === dp.sourceTileIndex) ?? revision.tiles[0];

    // 패널에 가장 많이 겹치는 원본 이미지 찾기
    const primarySourceImage =
      revision.sourceImages.find(
        (src) => dp.globalYStart >= src.globalYStart && dp.globalYStart < src.globalYEnd,
      ) ??
      revision.sourceImages[Math.min(pIdx, revision.sourceImages.length - 1)];

    const panelSegmentIds: string[] = [];
    const panelSoundCueIds: string[] = [];

    // 1. 시각 장면 해설 세그먼트 (Visual narration)
    if (dp.visualSummaryKo.trim() && dp.visualSummaryEn.trim()) {
      const narratorChar =
        castOutcome.characters.find((c) => c.canonicalNameKo === '해설') ??
        castOutcome.characters[0];

      const segId = `seg_${String(globalSegmentOrder + 1).padStart(4, '0')}`;
      const segBase: Segment = {
        segmentId: segId,
        panelId,
        episodeId: episode.episodeId,
        revisionId: revision.revisionId,
        orderIndex: globalSegmentOrder,
        kind: 'narration',
        speakerCharacterId: narratorChar?.characterId,
        textKo: dp.visualSummaryKo.trim(),
        textEn: dp.visualSummaryEn.trim(),
        deliveryStyleKo: dp.emotionalToneKo || '차분하고 선명한 장면 해설',
        deliveryStyleEn: dp.emotionalToneEn || 'Calm and clear visual description',
        pace: 'normal',
        pauseAfterMs: 260,
        audioAssetIdByLocale: {},
        inputHashByLocale: {},
      };
      segBase.inputHashByLocale.ko = computeSegmentAudioInputHash({
        segment: segBase,
        character: narratorChar,
        locale: 'ko',
      });
      segBase.inputHashByLocale.en = computeSegmentAudioInputHash({
        segment: segBase,
        character: narratorChar,
        locale: 'en',
      });

      segments.push(segBase);
      panelSegmentIds.push(segId);
      globalSegmentOrder += 1;
    }

    // 2. 대사 / 내레이션 / 시스템 창 / 텍스트형 효과음 세그먼트
    for (const rawSeg of dp.segments) {
      const resolvedCharId =
        castOutcome.speakerKeyToCharacterId[rawSeg.speakerKey] ??
        castOutcome.characters[0]?.characterId;
      const speakerChar = castOutcome.characters.find((c) => c.characterId === resolvedCharId);

      // 효과음 세그먼트인 경우 검증된 사운드 라이브러리 매칭 시도
      if (rawSeg.kind === 'sfx') {
        const matchedSfx = resolveSoundEffectAsset({
          rawTextKo: rawSeg.textKo,
          meaningKo: rawSeg.deliveryStyleKo || rawSeg.textKo,
          meaningEn: rawSeg.deliveryStyleEn || rawSeg.textEn,
          suggestedCategory: rawSeg.suggestedSfxCategory,
          confidence: rawSeg.sfxConfidence,
        });

        const cueId = `cue_${String(soundCues.length + 1).padStart(4, '0')}`;
        const cue: SoundCue = {
          cueId,
          panelId,
          episodeId: episode.episodeId,
          revisionId: revision.revisionId,
          orderIndex: soundCues.length,
          rawSfxTextKo: rawSeg.textKo,
          meaningKo: rawSeg.textKo,
          meaningEn: rawSeg.textEn,
          soundAssetId: matchedSfx.asset?.soundAssetId,
          confidence: rawSeg.sfxConfidence ?? 0.85,
          fallbackMode: matchedSfx.fallbackMode,
          offsetMs: 0,
          gainDb: -4,
        };
        soundCues.push(cue);
        panelSoundCueIds.push(cueId);

        // 사운드 에셋 매칭 신뢰도가 충분하면 오디오 큐로 재생하고, 불확실한 경우에만 음성 해설 세그먼트 추가
        if (matchedSfx.fallbackMode === 'sound_effect' && matchedSfx.asset) {
          continue;
        }
      }

      const segId = `seg_${String(globalSegmentOrder + 1).padStart(4, '0')}`;
      const seg: Segment = {
        segmentId: segId,
        panelId,
        episodeId: episode.episodeId,
        revisionId: revision.revisionId,
        orderIndex: globalSegmentOrder,
        kind: rawSeg.kind,
        speakerCharacterId: speakerChar?.characterId,
        textKo: rawSeg.textKo.trim(),
        textEn: rawSeg.textEn.trim(),
        deliveryStyleKo: rawSeg.deliveryStyleKo || '자연스러운 연기 톤',
        deliveryStyleEn: rawSeg.deliveryStyleEn || 'Natural acting tone',
        pace: 'normal',
        pauseAfterMs: rawSeg.kind === 'system_popup' ? 300 : 220,
        audioAssetIdByLocale: {},
        inputHashByLocale: {},
      };
      seg.inputHashByLocale.ko = computeSegmentAudioInputHash({
        segment: seg,
        character: speakerChar,
        locale: 'ko',
      });
      seg.inputHashByLocale.en = computeSegmentAudioInputHash({
        segment: seg,
        character: speakerChar,
        locale: 'en',
      });

      segments.push(seg);
      panelSegmentIds.push(segId);
      globalSegmentOrder += 1;
    }

    panels.push({
      panelId,
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      orderIndex: pIdx,
      sourceTileId: sourceTile.tileId,
      sourceImageId: primarySourceImage.sourceImageId,
      globalYStart: dp.globalYStart,
      globalYEnd: dp.globalYEnd,
      bbox: dp.bbox,
      visualSummaryKo: dp.visualSummaryKo,
      visualSummaryEn: dp.visualSummaryEn,
      emotionalToneKo: dp.emotionalToneKo,
      emotionalToneEn: dp.emotionalToneEn,
      continuityNote: dp.continuityNote,
      extraHoldMs: 350,
      segmentIds: panelSegmentIds,
      soundCueIds: panelSoundCueIds,
    });
  }

  revision.panels = panels;
  revision.segments = segments;
  revision.characters = castOutcome.characters;
  revision.soundCues = soundCues;
  revision.voicePoolExhausted = castOutcome.voicePoolExhausted;
  revision.updatedAt = new Date().toISOString();

  episode.panelCount = panels.length;
  episode.characterCount = castOutcome.characters.length;
  episode.voicePoolExhausted = castOutcome.voicePoolExhausted;
  episode.updatedAt = revision.updatedAt;

  await saveRevision(revision);
  await saveEpisode(episode);
  return { episode, revision };
}

// 선택적 세그먼트 음성 합성 (inputHash 일치 시 기존 오디오 재사용)
export async function synthesizeRevisionAudio(params: {
  episodeId: string;
  revisionId: string;
  locales?: LocaleCode[];
  onlySegmentIds?: string[];
  ttsSynthesizerOverride?: (args: {
    segment: Segment;
    locale: LocaleCode;
    voiceName: string;
  }) => Promise<{
    wavBuffer: Buffer;
    durationMs: number;
    sampleRateHz: number;
    sha256: string;
    modelId: string;
  }>;
}): Promise<{
  revision: Revision;
  synthesizedCount: number;
  reusedCount: number;
}> {
  const episode = await getEpisode(params.episodeId);
  let revision = await getRevision(params.episodeId, params.revisionId);
  if (!episode || !revision) {
    throw new Error(`Episode or revision not found: ${params.episodeId}/${params.revisionId}`);
  }

  episode.status = 'synthesizing';
  revision.status = 'synthesizing';
  await saveEpisode(episode);
  await saveRevision(revision);

  const locales: LocaleCode[] = params.locales ?? ['ko', 'en'];
  const targetSegmentSet = params.onlySegmentIds ? new Set(params.onlySegmentIds) : null;

  let synthesizedCount = 0;
  let reusedCount = 0;

  for (const segment of revision.segments) {
    if (targetSegmentSet && !targetSegmentSet.has(segment.segmentId)) {
      continue;
    }

    const speaker = revision.characters.find((c) => c.characterId === segment.speakerCharacterId);

    for (const locale of locales) {
      const expectedHash = computeSegmentAudioInputHash({
        segment,
        character: speaker,
        locale,
      });
      segment.inputHashByLocale[locale] = expectedHash;

      // 이미 동일한 inputHash를 가진 오디오 에셋이 있는지 확인 (선택적 재생성 T07)
      const existingAssetId = segment.audioAssetIdByLocale[locale];
      const existingAsset = revision.audioAssets.find(
        (a) =>
          (existingAssetId && a.audioAssetId === existingAssetId && a.inputHash === expectedHash) ||
          (a.segmentId === segment.segmentId &&
            a.locale === locale &&
            a.inputHash === expectedHash),
      );

      if (existingAsset) {
        segment.audioAssetIdByLocale[locale] = existingAsset.audioAssetId;
        reusedCount += 1;
        continue;
      }

      const voiceName =
        locale === 'ko'
          ? speaker?.voiceProfile.koVoiceName || 'Kore'
          : speaker?.voiceProfile.enVoiceName || 'Puck';

      const { task } = await enqueueIdempotentTask({
        episodeId: episode.episodeId,
        revisionId: revision.revisionId,
        taskType: 'segment_tts',
        idempotencyKeyParts: [segment.segmentId, locale, expectedHash],
        payload: {
          segmentId: segment.segmentId,
          locale,
          inputHash: expectedHash,
        },
      });

      const leased = await claimTaskLease(task);
      const activeTask = leased ?? task;

      try {
        const text = locale === 'ko' ? segment.textKo : segment.textEn;
        const stylePrompt =
          locale === 'ko'
            ? `${speaker?.voiceProfile.stylePromptKo || ''} ${segment.deliveryStyleKo}`.trim()
            : `${speaker?.voiceProfile.stylePromptEn || ''} ${segment.deliveryStyleEn}`.trim();

        const synthResult = params.ttsSynthesizerOverride
          ? await params.ttsSynthesizerOverride({ segment, locale, voiceName })
          : await synthesizeSegmentTtsWithGemini({
              text,
              stylePrompt,
              voiceName,
              locale,
              speakingRate: speaker?.voiceProfile.speakingRate ?? 1.0,
            });

        const audioAssetId = `aud_${segment.segmentId}_${locale}_${expectedHash.slice(0, 10)}`;
        const relativeKey = `episodes/${episode.episodeId}/${revision.revisionId}/audio/${audioAssetId}.wav`;
        const storageUri = await storeBinaryAsset(relativeKey, synthResult.wavBuffer, 'audio/wav');

        const newAsset: AudioAsset = {
          audioAssetId,
          episodeId: episode.episodeId,
          revisionId: revision.revisionId,
          segmentId: segment.segmentId,
          locale,
          voiceName,
          inputHash: expectedHash,
          mimeType: 'audio/wav',
          byteSize: synthResult.wavBuffer.byteLength,
          durationMs: synthResult.durationMs,
          sampleRateHz: synthResult.sampleRateHz,
          sha256: synthResult.sha256,
          storageUri,
          createdAt: new Date().toISOString(),
        };

        // inputHash 가드 적용: 오래된 작업 결과가 최신 수정을 덮어쓰지 못하도록 보호 (T17)
        const guardResult = await recordAudioAssetWithInputHashGuard({
          episodeId: episode.episodeId,
          revisionId: revision.revisionId,
          segmentId: segment.segmentId,
          locale,
          expectedInputHash: expectedHash,
          asset: newAsset,
        });

        if (guardResult.applied) {
          synthesizedCount += 1;
        }
        await completeTask(activeTask, 'succeeded');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await completeTask(activeTask, 'failed', msg);
        throw err;
      }
    }
  }

  const refreshed = await getRevision(params.episodeId, params.revisionId);
  if (refreshed) {
    revision = refreshed;
  }
  return { revision, synthesizedCount, reusedCount };
}

// 매니페스트 생성 + 검증 + 1회 자동 보정 루프 + 조건부 자동 게시
export async function validateAndFinalizeRevision(params: {
  episodeId: string;
  revisionId: string;
  autoPublishIfValid?: boolean;
  ttsSynthesizerOverride?: (args: {
    segment: Segment;
    locale: LocaleCode;
    voiceName: string;
  }) => Promise<{
    wavBuffer: Buffer;
    durationMs: number;
    sampleRateHz: number;
    sha256: string;
    modelId: string;
  }>;
}): Promise<{
  episode: Episode;
  revision: Revision;
  initialReport: ValidationReport;
  finalReport: ValidationReport;
  autoCorrectionNotes: string[];
  published: boolean;
}> {
  await ensureSoundLibraryLoaded();
  const soundLibraryMap = new Map(ENSURED_SOUND_LIBRARY.map((s) => [s.soundAssetId, s]));

  let revision = await getRevision(params.episodeId, params.revisionId);
  let episode = await getEpisode(params.episodeId);
  if (!revision || !episode) {
    throw new Error(`Episode or revision not found: ${params.episodeId}/${params.revisionId}`);
  }

  revision.status = 'validating';
  episode.status = 'validating';
  await saveRevision(revision);
  await saveEpisode(episode);

  // 1차 매니페스트 생성 및 검증
  revision.manifests.ko = buildPlaybackManifestForLocale({
    revision,
    locale: 'ko',
    soundLibraryById: soundLibraryMap,
  });
  revision.manifests.en = buildPlaybackManifestForLocale({
    revision,
    locale: 'en',
    soundLibraryById: soundLibraryMap,
  });

  const initialReport = validateRevisionForPublish({
    revision,
    soundLibraryById: soundLibraryMap,
  });

  let finalReport = initialReport;
  let autoCorrectionNotes: string[] = [];

  // 복구 가능한 검증 오류 발견 시 1회 자동 보정 실행
  if (!initialReport.valid) {
    const repairOutcome = repairRecoverableValidationIssuesOnce({
      revision,
      report: initialReport,
    });

    if (repairOutcome.repaired) {
      autoCorrectionNotes = repairOutcome.notes;
      await saveRevision(revision);

      // 보정으로 인해 새로 생성되거나 변경된 세그먼트의 오디오 합성
      const synthAfterRepair = await synthesizeRevisionAudio({
        episodeId: revision.episodeId,
        revisionId: revision.revisionId,
        ttsSynthesizerOverride: params.ttsSynthesizerOverride,
      });
      revision = synthAfterRepair.revision;

      revision.manifests.ko = buildPlaybackManifestForLocale({
        revision,
        locale: 'ko',
        soundLibraryById: soundLibraryMap,
      });
      revision.manifests.en = buildPlaybackManifestForLocale({
        revision,
        locale: 'en',
        soundLibraryById: soundLibraryMap,
      });

      // 동일한 검증 함수를 재실행하여 통과 여부 확인
      finalReport = validateRevisionForPublish({
        revision,
        soundLibraryById: soundLibraryMap,
      });
      finalReport.autoCorrectionAttempted = true;
      finalReport.autoCorrectionSucceeded = finalReport.valid;
      finalReport.autoCorrectionNotes = autoCorrectionNotes;
    }
  }

  revision.validationReport = finalReport;
  if (revision.manifests.ko) {
    await saveManifest(revision.manifests.ko);
  }
  if (revision.manifests.en) {
    await saveManifest(revision.manifests.en);
  }

  let published = false;
  const shouldAutoPublish =
    params.autoPublishIfValid ?? revision.publishMode === 'auto_publish';

  if (finalReport.valid) {
    revision.status = 'ready';
    episode.status = 'ready';
    await saveRevision(revision);
    await saveEpisode(episode);

    if (shouldAutoPublish) {
      const pubResult = await publishRevisionAtomically({
        episodeId: episode.episodeId,
        revisionId: revision.revisionId,
      });
      episode = pubResult.episode;
      revision = pubResult.revision;
      published = true;
    }
  } else {
    revision.status = 'failed';
    episode.status = 'failed';
    await saveRevision(revision);
    await saveEpisode(episode);
  }

  return {
    episode,
    revision,
    initialReport,
    finalReport,
    autoCorrectionNotes,
    published,
  };
}
