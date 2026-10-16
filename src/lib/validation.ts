import crypto from 'node:crypto';
import type {
  Character,
  LocaleCode,
  ManifestPanelEntry,
  ManifestSegmentEntry,
  ManifestSoundCueEntry,
  PlaybackManifest,
  Revision,
  Segment,
  SoundAsset,
  ValidationIssue,
  ValidationReport,
} from './types';
import { resolveSpeakerDisplayNameAtPanel } from './cast';

export const MAX_SEGMENT_CHAR_LENGTH = 360;

// 세그먼트 오디오 캐시/무효화 판별용 결정론적 inputHash 생성 (T07, T17)
export function computeSegmentAudioInputHash(params: {
  segment: Segment;
  character?: Character;
  locale: LocaleCode;
}): string {
  const { segment, character, locale } = params;
  const text = locale === 'ko' ? segment.textKo : segment.textEn;
  const delivery = locale === 'ko' ? segment.deliveryStyleKo : segment.deliveryStyleEn;
  const voiceName =
    locale === 'ko'
      ? character?.voiceProfile.koVoiceName || 'Kore'
      : character?.voiceProfile.enVoiceName || 'Puck';
  const stylePrompt =
    locale === 'ko'
      ? character?.voiceProfile.stylePromptKo || ''
      : character?.voiceProfile.stylePromptEn || '';
  const rate = character?.voiceProfile.speakingRate ?? 1.0;
  const pitch = character?.voiceProfile.pitchSemitones ?? 0;

  const payload = JSON.stringify({
    promptVersion: 'v2_clean_spoken_only',
    locale,
    kind: segment.kind,
    speakerId: segment.speakerCharacterId || 'narrator',
    voiceName,
    stylePrompt: stylePrompt.trim(),
    delivery: delivery.trim(),
    pace: segment.pace,
    rate,
    pitch,
    text: text.trim(),
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

// 언어별(ko/en) 재생 매니페스트 생성 (스포일러 보호 호칭 및 비공개 에셋 프록시 URL 반영)
export function buildPlaybackManifestForLocale(params: {
  revision: Revision;
  locale: LocaleCode;
  soundLibraryById: Map<string, SoundAsset>;
}): PlaybackManifest {
  const { revision, locale, soundLibraryById } = params;
  const sortedPanels = [...revision.panels].sort((a, b) => a.orderIndex - b.orderIndex);
  const charById = new Map(revision.characters.map((c) => [c.characterId, c]));
  const audioById = new Map(revision.audioAssets.map((a) => [a.audioAssetId, a]));

  const manifestPanels: ManifestPanelEntry[] = [];
  let totalSegments = 0;
  let totalDurationMs = 0;

  for (const panel of sortedPanels) {
    const panelSegments = revision.segments
      .filter((s) => s.panelId === panel.panelId)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const panelCues = revision.soundCues
      .filter((c) => c.panelId === panel.panelId)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const cueEntries: ManifestSoundCueEntry[] = panelCues.map((cue) => {
      const soundAsset = cue.soundAssetId ? soundLibraryById.get(cue.soundAssetId) : undefined;
      const useEffect = Boolean(soundAsset && cue.fallbackMode === 'sound_effect');
      if (useEffect && soundAsset) {
        totalDurationMs += soundAsset.durationMs;
      }
      return {
        cueId: cue.cueId,
        rawSfxTextKo: cue.rawSfxTextKo,
        meaning: locale === 'ko' ? cue.meaningKo : cue.meaningEn,
        soundAssetId: useEffect ? cue.soundAssetId : undefined,
        audioUrl:
          useEffect && cue.soundAssetId ? `/api/assets/sfx/${cue.soundAssetId}.wav` : undefined,
        fallbackMode: useEffect ? 'sound_effect' : 'text_only',
        offsetMs: cue.offsetMs,
        gainDb: cue.gainDb,
      };
    });

    const segEntries: ManifestSegmentEntry[] = panelSegments.map((seg) => {
      const char = seg.speakerCharacterId ? charById.get(seg.speakerCharacterId) : undefined;
      const speakerDisplayName = resolveSpeakerDisplayNameAtPanel({
        character: char,
        panelOrderIndex: panel.orderIndex,
        panels: sortedPanels,
        locale,
      });

      const expectedHash = computeSegmentAudioInputHash({
        segment: seg,
        character: char,
        locale,
      });

      const assetId = seg.audioAssetIdByLocale[locale] || '';
      const asset =
        audioById.get(assetId) ||
        revision.audioAssets.find(
          (a) => a.segmentId === seg.segmentId && a.locale === locale && a.inputHash === expectedHash,
        );

      const resolvedAssetId = asset?.audioAssetId || assetId;
      const durationMs = asset?.durationMs ?? 1200;
      totalDurationMs += durationMs + seg.pauseAfterMs;
      totalSegments += 1;

      const voiceName =
        locale === 'ko'
          ? char?.voiceProfile.koVoiceName || 'Kore'
          : char?.voiceProfile.enVoiceName || 'Puck';

      return {
        segmentId: seg.segmentId,
        orderIndex: seg.orderIndex,
        kind: seg.kind,
        speakerCharacterId: seg.speakerCharacterId,
        speakerDisplayName,
        voiceName,
        text: locale === 'ko' ? seg.textKo : seg.textEn,
        deliveryStyle: locale === 'ko' ? seg.deliveryStyleKo : seg.deliveryStyleEn,
        audioAssetId: resolvedAssetId,
        audioUrl: resolvedAssetId
          ? `/api/assets/${revision.episodeId}/${revision.revisionId}/audio/${resolvedAssetId}.wav`
          : '',
        durationMs,
        pauseAfterMs: seg.pauseAfterMs,
        inputHash: expectedHash,
      };
    });

    totalDurationMs += panel.extraHoldMs;

    manifestPanels.push({
      panelId: panel.panelId,
      orderIndex: panel.orderIndex,
      sourceImageId: panel.sourceImageId,
      imageUrl: `/api/assets/${revision.episodeId}/${revision.revisionId}/source/${panel.sourceImageId}`,
      highContrastImageUrl: `/api/assets/${revision.episodeId}/${revision.revisionId}/source/${panel.sourceImageId}?contrast=high`,
      globalYStart: panel.globalYStart,
      globalYEnd: panel.globalYEnd,
      bbox: panel.bbox,
      visualSummary: locale === 'ko' ? panel.visualSummaryKo : panel.visualSummaryEn,
      emotionalTone: locale === 'ko' ? panel.emotionalToneKo : panel.emotionalToneEn,
      extraHoldMs: panel.extraHoldMs,
      soundCues: cueEntries,
      segments: segEntries,
    });
  }

  return {
    manifestId: `man_${revision.episodeId}_${revision.revisionId}_${locale}`,
    episodeId: revision.episodeId,
    revisionId: revision.revisionId,
    locale,
    panels: manifestPanels,
    totalPanels: manifestPanels.length,
    totalSegments,
    totalDurationMs,
    createdAt: new Date().toISOString(),
  };
}

// 출판 전 10단계 품질 및 접근성 무결성 검증 (T06)
export function validateRevisionForPublish(params: {
  revision: Revision;
  soundLibraryById: Map<string, SoundAsset>;
}): ValidationReport {
  const { revision, soundLibraryById } = params;
  const issues: ValidationIssue[] = [];

  // 1. 패널 존재 여부
  if (revision.panels.length === 0) {
    issues.push({
      code: 'NO_PANELS',
      severity: 'error',
      message: '분석된 컷(Panel)이 하나도 없습니다.',
      recoverable: false,
    });
  }

  const charIds = new Set(revision.characters.map((c) => c.characterId));
  const audioById = new Map(revision.audioAssets.map((a) => [a.audioAssetId, a]));

  // 2. 패널별 시각 해설 및 세그먼트 존재 검증
  for (const panel of revision.panels) {
    if (!panel.visualSummaryKo.trim() || !panel.visualSummaryEn.trim()) {
      issues.push({
        code: 'EMPTY_PANEL_VISUAL_SUMMARY',
        severity: 'error',
        panelId: panel.panelId,
        message: `컷(${panel.panelId})의 한/영 시각 장면 해설이 비어 있습니다.`,
        recoverable: true,
      });
    }

    const panelSegs = revision.segments.filter((s) => s.panelId === panel.panelId);
    if (panelSegs.length === 0) {
      issues.push({
        code: 'PANEL_WITHOUT_SEGMENTS',
        severity: 'error',
        panelId: panel.panelId,
        message: `컷(${panel.panelId})에 재생할 오디오 세그먼트가 없습니다.`,
        recoverable: true,
      });
    }
  }

  // 3. 세그먼트 텍스트, 화자 매핑, 길이 제한, 오디오 에셋 무결성 검증
  for (const seg of revision.segments) {
    if (!seg.textKo.trim() || !seg.textEn.trim()) {
      issues.push({
        code: 'EMPTY_SEGMENT_TEXT',
        severity: 'error',
        panelId: seg.panelId,
        segmentId: seg.segmentId,
        message: `세그먼트(${seg.segmentId})의 한국어 또는 영어 대본이 비어 있습니다.`,
        recoverable: true,
      });
    }

    if (
      seg.textKo.length > MAX_SEGMENT_CHAR_LENGTH ||
      seg.textEn.length > MAX_SEGMENT_CHAR_LENGTH
    ) {
      issues.push({
        code: 'SEGMENT_TEXT_TOO_LONG',
        severity: 'warning',
        panelId: seg.panelId,
        segmentId: seg.segmentId,
        message: `세그먼트(${seg.segmentId}) 길이가 권장 상한(${MAX_SEGMENT_CHAR_LENGTH}자)을 초과했습니다.`,
        recoverable: true,
      });
    }

    if (!seg.speakerCharacterId || !charIds.has(seg.speakerCharacterId)) {
      issues.push({
        code: 'UNMAPPED_SPEAKER_CHARACTER',
        severity: 'error',
        panelId: seg.panelId,
        segmentId: seg.segmentId,
        message: `세그먼트(${seg.segmentId})의 화자(${seg.speakerCharacterId ?? 'none'})가 등장인물 목록에 없습니다.`,
        recoverable: true,
      });
    }

    const speaker = revision.characters.find((c) => c.characterId === seg.speakerCharacterId);
    for (const locale of ['ko', 'en'] as const) {
      const expectedHash = computeSegmentAudioInputHash({
        segment: seg,
        character: speaker,
        locale,
      });
      const assetId = seg.audioAssetIdByLocale[locale];
      const asset = assetId ? audioById.get(assetId) : undefined;

      if (!asset) {
        issues.push({
          code: 'MISSING_SEGMENT_AUDIO',
          severity: 'error',
          panelId: seg.panelId,
          segmentId: seg.segmentId,
          locale,
          message: `세그먼트(${seg.segmentId})의 ${locale.toUpperCase()} 오디오 에셋이 누락되었습니다.`,
          recoverable: true,
        });
      } else if (asset.inputHash !== expectedHash) {
        issues.push({
          code: 'STALE_SEGMENT_AUDIO_HASH',
          severity: 'error',
          panelId: seg.panelId,
          segmentId: seg.segmentId,
          locale,
          message: `세그먼트(${seg.segmentId})의 ${locale.toUpperCase()} 오디오 해시가 최신 대본/보이스 설정과 일치하지 않습니다.`,
          recoverable: true,
        });
      } else if (asset.durationMs <= 0 || asset.byteSize <= 44) {
        issues.push({
          code: 'INVALID_AUDIO_DURATION',
          severity: 'error',
          panelId: seg.panelId,
          segmentId: seg.segmentId,
          locale,
          message: `세그먼트(${seg.segmentId})의 ${locale.toUpperCase()} 오디오 길이가 유효하지 않습니다.`,
          recoverable: true,
        });
      }
    }
  }

  // 4. 사운드 효과 큐 참조 검증
  for (const cue of revision.soundCues) {
    if (cue.fallbackMode === 'sound_effect') {
      if (!cue.soundAssetId || !soundLibraryById.has(cue.soundAssetId)) {
        issues.push({
          code: 'UNVERIFIED_SOUND_ASSET',
          severity: 'error',
          panelId: cue.panelId,
          cueId: cue.cueId,
          message: `효과음 큐(${cue.cueId})가 검증된 사운드 라이브러리에 없는 에셋(${cue.soundAssetId ?? 'none'})을 참조합니다.`,
          recoverable: true,
        });
      }
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');

  return {
    reportId: `val_${revision.episodeId}_${revision.revisionId}_${Date.now().toString(36)}`,
    episodeId: revision.episodeId,
    revisionId: revision.revisionId,
    valid: !hasError,
    checkedAt: new Date().toISOString(),
    issues,
    autoCorrectionAttempted: false,
    autoCorrectionSucceeded: false,
    autoCorrectionNotes: [],
    stats: {
      panelCount: revision.panels.length,
      segmentCount: revision.segments.length,
      characterCount: revision.characters.length,
      audioAssetCount: revision.audioAssets.length,
      soundCueCount: revision.soundCues.length,
    },
  };
}

// 복구 가능한 검증 오류 발견 시 1회 자동 보정 수행 후 재검증으로 넘김 (T06)
export function repairRecoverableValidationIssuesOnce(params: {
  revision: Revision;
  report: ValidationReport;
}): {
  repaired: boolean;
  notes: string[];
} {
  const { revision, report } = params;
  const notes: string[] = [];
  let mutated = false;

  // 기본 해설 캐릭터 보장
  let narrator = revision.characters.find(
    (c) => c.characterId === 'char_narrator' || c.canonicalNameKo === '해설',
  );
  if (!narrator) {
    narrator = {
      characterId: 'char_narrator',
      episodeId: revision.episodeId,
      revisionId: revision.revisionId,
      canonicalNameKo: '해설',
      canonicalNameEn: 'Narrator',
      aliases: ['해설', 'narrator'],
      unrevealedLabelKo: '해설',
      unrevealedLabelEn: 'Narrator',
      genderHint: 'neutral',
      ageHint: 'young_adult',
      voiceProfile: {
        voiceProfileId: 'vp_narrator',
        koVoiceName: 'Kore',
        enVoiceName: 'Kore',
        stylePromptKo: '차분하고 또렷한 장면 해설',
        stylePromptEn: 'Calm and clear narration',
        speakingRate: 1.0,
        pitchSemitones: 0,
      },
    };
    revision.characters.unshift(narrator);
    mutated = true;
    notes.push('기본 해설(Narrator) 보이스 프로필을 자동 복구했습니다.');
  }

  const validCharIds = new Set(revision.characters.map((c) => c.characterId));

  // 1. 빈 패널 시각 해설 및 세그먼트 누락 패널 복구
  for (const panel of revision.panels) {
    if (!panel.visualSummaryKo.trim()) {
      panel.visualSummaryKo = `${panel.orderIndex + 1}번째 컷의 인물과 배경 연출 장면입니다.`;
      mutated = true;
      notes.push(`컷(${panel.panelId})의 누락된 한국어 시각 해설을 보충했습니다.`);
    }
    if (!panel.visualSummaryEn.trim()) {
      panel.visualSummaryEn = `Scene depiction for cut ${panel.orderIndex + 1}.`;
      mutated = true;
      notes.push(`컷(${panel.panelId})의 누락된 영어 시각 해설을 보충했습니다.`);
    }

    const panelSegs = revision.segments.filter((s) => s.panelId === panel.panelId);
    if (panelSegs.length === 0) {
      const segId = `seg_repair_${panel.panelId}`;
      const newSeg: Segment = {
        segmentId: segId,
        panelId: panel.panelId,
        episodeId: revision.episodeId,
        revisionId: revision.revisionId,
        orderIndex: revision.segments.length,
        kind: 'narration',
        speakerCharacterId: narrator.characterId,
        textKo: panel.visualSummaryKo,
        textEn: panel.visualSummaryEn,
        deliveryStyleKo: panel.emotionalToneKo || '차분한 장면 해설',
        deliveryStyleEn: panel.emotionalToneEn || 'Calm scene description',
        pace: 'normal',
        pauseAfterMs: 240,
        audioAssetIdByLocale: {},
        inputHashByLocale: {},
      };
      revision.segments.push(newSeg);
      if (!panel.segmentIds.includes(segId)) {
        panel.segmentIds.push(segId);
      }
      mutated = true;
      notes.push(`세그먼트가 없던 컷(${panel.panelId})에 시각 장면 해설 세그먼트를 자동 생성했습니다.`);
    }
  }

  // 2. 빈 세그먼트 텍스트, 미매핑 화자, 과도한 길이 자동 보정
  for (const seg of revision.segments) {
    const parentPanel = revision.panels.find((p) => p.panelId === seg.panelId);
    if (!seg.textKo.trim() && seg.textEn.trim()) {
      seg.textKo = seg.textEn.trim();
      mutated = true;
      notes.push(`세그먼트(${seg.segmentId})의 빈 한국어 대본을 보정했습니다.`);
    } else if (!seg.textKo.trim()) {
      seg.textKo = parentPanel?.visualSummaryKo || '장면이 전환됩니다.';
      mutated = true;
      notes.push(`세그먼트(${seg.segmentId})의 빈 한국어 대본을 컷 장면 해설로 대체했습니다.`);
    }

    if (!seg.textEn.trim() && seg.textKo.trim()) {
      seg.textEn = parentPanel?.visualSummaryEn || seg.textKo.trim();
      mutated = true;
      notes.push(`세그먼트(${seg.segmentId})의 빈 영어 대본을 보정했습니다.`);
    }

    if (seg.textKo.length > MAX_SEGMENT_CHAR_LENGTH) {
      seg.textKo = `${seg.textKo.slice(0, MAX_SEGMENT_CHAR_LENGTH - 3).trim()}...`;
      mutated = true;
      notes.push(`세그먼트(${seg.segmentId})의 과도한 한국어 텍스트 길이를 호흡 단위로 축약했습니다.`);
    }
    if (seg.textEn.length > MAX_SEGMENT_CHAR_LENGTH) {
      seg.textEn = `${seg.textEn.slice(0, MAX_SEGMENT_CHAR_LENGTH - 3).trim()}...`;
      mutated = true;
      notes.push(`세그먼트(${seg.segmentId})의 과도한 영어 텍스트 길이를 호흡 단위로 축약했습니다.`);
    }

    if (!seg.speakerCharacterId || !validCharIds.has(seg.speakerCharacterId)) {
      seg.speakerCharacterId = narrator.characterId;
      mutated = true;
      notes.push(`세그먼트(${seg.segmentId})의 누락된 화자 매핑을 기본 해설자로 복구했습니다.`);
    }
  }

  // 3. 미검증 사운드 효과 큐를 안전한 음성 해설 폴백(text_only)으로 전환
  for (const cue of revision.soundCues) {
    const hasUnverifiedIssue = report.issues.some(
      (i) => i.code === 'UNVERIFIED_SOUND_ASSET' && i.cueId === cue.cueId,
    );
    if (hasUnverifiedIssue) {
      cue.fallbackMode = 'text_only';
      cue.soundAssetId = undefined;
      mutated = true;
      notes.push(`미검증 음향 에셋을 참조하던 큐(${cue.cueId})를 음성 해설 폴백(text_only)으로 전환했습니다.`);
    }
  }

  // Missing/Stale audio issue가 있으면 이후 synthesizeRevisionAudio 호출로 복구 가능 표시
  const hasMissingOrStaleAudio = report.issues.some(
    (i) => i.code === 'MISSING_SEGMENT_AUDIO' || i.code === 'STALE_SEGMENT_AUDIO_HASH',
  );
  if (hasMissingOrStaleAudio) {
    mutated = true;
    notes.push('누락되거나 변경된 세그먼트의 오디오 합성을 재실행하도록 예약했습니다.');
  }

  if (mutated) {
    revision.autoCorrectionApplied = true;
  }

  return {
    repaired: mutated,
    notes,
  };
}
