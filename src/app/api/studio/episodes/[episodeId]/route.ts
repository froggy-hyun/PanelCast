import { NextRequest, NextResponse } from 'next/server';
import { verifyPublisherRequest } from '@/lib/auth';
import {
  cloneRevisionAsEditableDraft,
  deleteEpisode,
  getEpisode,
  getEpisodeTasks,
  getRevision,
  saveEpisode,
  saveRevision,
} from '@/lib/store';
import { ENSURED_SOUND_LIBRARY, ensureSoundLibraryLoaded } from '@/lib/sound-library';
import { PREBUILT_VOICES } from '@/lib/cast';
import { computeSegmentAudioInputHash } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ episodeId: string }> },
) {
  const auth = verifyPublisherRequest(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { episodeId } = await context.params;
  const episode = await getEpisode(episodeId);
  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  const requestedRevId =
    req.nextUrl.searchParams.get('revisionId') || episode.activeDraftRevisionId;
  const revision = await getRevision(episodeId, requestedRevId);
  if (!revision) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  }

  await ensureSoundLibraryLoaded();
  const tasks = await getEpisodeTasks(episodeId, revision.revisionId);

  return NextResponse.json({
    episode,
    revision,
    tasks,
    soundLibrary: ENSURED_SOUND_LIBRARY,
    prebuiltVoices: PREBUILT_VOICES,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ episodeId: string }> },
) {
  const auth = verifyPublisherRequest(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { episodeId } = await context.params;
  const episode = await getEpisode(episodeId);
  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  const body = (await req.json()) as {
    revisionId?: string;
    action?: 'create_draft' | 'merge_characters' | 'split_character' | 'update_entities';
    sourceRevisionId?: string;
    mergeSourceCharacterId?: string;
    mergeTargetCharacterId?: string;
    splitSourceCharacterId?: string;
    splitNewNameKo?: string;
    splitNewNameEn?: string;
    splitSegmentIds?: string[];
    characters?: Array<{
      characterId: string;
      canonicalNameKo?: string;
      canonicalNameEn?: string;
      unrevealedLabelKo?: string;
      unrevealedLabelEn?: string;
      revealedAtPanelId?: string | null;
      koVoiceName?: string;
      enVoiceName?: string;
      stylePromptKo?: string;
      stylePromptEn?: string;
      speakingRate?: number;
      pitchSemitones?: number;
    }>;
    panels?: Array<{
      panelId: string;
      visualSummaryKo?: string;
      visualSummaryEn?: string;
      emotionalToneKo?: string;
      emotionalToneEn?: string;
      extraHoldMs?: number;
    }>;
    segments?: Array<{
      segmentId: string;
      speakerCharacterId?: string;
      textKo?: string;
      textEn?: string;
      deliveryStyleKo?: string;
      deliveryStyleEn?: string;
      pace?: 'slow' | 'normal' | 'fast';
      pauseAfterMs?: number;
    }>;
    soundCues?: Array<{
      cueId: string;
      soundAssetId?: string | null;
      fallbackMode?: 'sound_effect' | 'text_only';
      gainDb?: number;
      meaningKo?: string;
      meaningEn?: string;
    }>;
  };

  if (body.action === 'create_draft') {
    const sourceRevId =
      body.sourceRevisionId || episode.publishedRevisionId || episode.activeDraftRevisionId;
    const newDraft = await cloneRevisionAsEditableDraft(episodeId, sourceRevId);
    const updatedEpisode = await getEpisode(episodeId);
    return NextResponse.json({ episode: updatedEpisode, revision: newDraft });
  }

  const targetRevId = body.revisionId || episode.activeDraftRevisionId;
  const revision = await getRevision(episodeId, targetRevId);
  if (!revision) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  }

  // 인물 병합 (Merge characters)
  if (
    body.action === 'merge_characters' &&
    body.mergeSourceCharacterId &&
    body.mergeTargetCharacterId &&
    body.mergeSourceCharacterId !== body.mergeTargetCharacterId
  ) {
    const srcChar = revision.characters.find(
      (c) => c.characterId === body.mergeSourceCharacterId,
    );
    const dstChar = revision.characters.find(
      (c) => c.characterId === body.mergeTargetCharacterId,
    );
    if (srcChar && dstChar) {
      dstChar.aliases = Array.from(
        new Set([...dstChar.aliases, srcChar.canonicalNameKo, ...srcChar.aliases]),
      );
      for (const seg of revision.segments) {
        if (seg.speakerCharacterId === srcChar.characterId) {
          seg.speakerCharacterId = dstChar.characterId;
        }
      }
      revision.characters = revision.characters.filter(
        (c) => c.characterId !== srcChar.characterId,
      );
    }
  }

  // 인물 분리 (Split character)
  if (
    body.action === 'split_character' &&
    body.splitSourceCharacterId &&
    body.splitNewNameKo &&
    Array.isArray(body.splitSegmentIds) &&
    body.splitSegmentIds.length > 0
  ) {
    const srcChar = revision.characters.find(
      (c) => c.characterId === body.splitSourceCharacterId,
    );
    if (srcChar) {
      const nextCharId = `char_${String(revision.characters.length + 1).padStart(2, '0')}`;
      const voicePreset =
        PREBUILT_VOICES[revision.characters.length % PREBUILT_VOICES.length];
      const newChar = {
        ...structuredClone(srcChar),
        characterId: nextCharId,
        canonicalNameKo: body.splitNewNameKo.trim(),
        canonicalNameEn: (body.splitNewNameEn || body.splitNewNameKo).trim(),
        aliases: [body.splitNewNameKo.trim()],
        voiceProfile: {
          ...structuredClone(srcChar.voiceProfile),
          voiceProfileId: `vp_${nextCharId}`,
          koVoiceName: voicePreset.voiceName,
          enVoiceName: voicePreset.voiceName,
        },
      };
      revision.characters.push(newChar);
      const splitSet = new Set(body.splitSegmentIds);
      for (const seg of revision.segments) {
        if (splitSet.has(seg.segmentId)) {
          seg.speakerCharacterId = newChar.characterId;
        }
      }
    }
  }

  // 캐릭터 보이스 및 스포일러 공개 시점 수정
  if (Array.isArray(body.characters)) {
    for (const patchChar of body.characters) {
      const target = revision.characters.find((c) => c.characterId === patchChar.characterId);
      if (!target) continue;
      if (typeof patchChar.canonicalNameKo === 'string') {
        target.canonicalNameKo = patchChar.canonicalNameKo.trim();
      }
      if (typeof patchChar.canonicalNameEn === 'string') {
        target.canonicalNameEn = patchChar.canonicalNameEn.trim();
      }
      if (typeof patchChar.unrevealedLabelKo === 'string') {
        target.unrevealedLabelKo = patchChar.unrevealedLabelKo.trim();
      }
      if (typeof patchChar.unrevealedLabelEn === 'string') {
        target.unrevealedLabelEn = patchChar.unrevealedLabelEn.trim();
      }
      if (patchChar.revealedAtPanelId !== undefined) {
        target.revealedAtPanelId = patchChar.revealedAtPanelId || undefined;
      }
      if (typeof patchChar.koVoiceName === 'string') {
        target.voiceProfile.koVoiceName = patchChar.koVoiceName;
      }
      if (typeof patchChar.enVoiceName === 'string') {
        target.voiceProfile.enVoiceName = patchChar.enVoiceName;
      }
      if (typeof patchChar.stylePromptKo === 'string') {
        target.voiceProfile.stylePromptKo = patchChar.stylePromptKo;
      }
      if (typeof patchChar.stylePromptEn === 'string') {
        target.voiceProfile.stylePromptEn = patchChar.stylePromptEn;
      }
      if (typeof patchChar.speakingRate === 'number') {
        target.voiceProfile.speakingRate = Math.min(Math.max(patchChar.speakingRate, 0.7), 1.4);
      }
      if (typeof patchChar.pitchSemitones === 'number') {
        target.voiceProfile.pitchSemitones = Math.min(Math.max(patchChar.pitchSemitones, -6), 6);
      }
    }
  }

  // 패널 해설 및 전환 대기 시간(extraHoldMs) 수정
  if (Array.isArray(body.panels)) {
    for (const patchPanel of body.panels) {
      const target = revision.panels.find((p) => p.panelId === patchPanel.panelId);
      if (!target) continue;
      if (typeof patchPanel.visualSummaryKo === 'string') {
        target.visualSummaryKo = patchPanel.visualSummaryKo;
      }
      if (typeof patchPanel.visualSummaryEn === 'string') {
        target.visualSummaryEn = patchPanel.visualSummaryEn;
      }
      if (typeof patchPanel.emotionalToneKo === 'string') {
        target.emotionalToneKo = patchPanel.emotionalToneKo;
      }
      if (typeof patchPanel.emotionalToneEn === 'string') {
        target.emotionalToneEn = patchPanel.emotionalToneEn;
      }
      if (typeof patchPanel.extraHoldMs === 'number') {
        target.extraHoldMs = Math.min(Math.max(Math.round(patchPanel.extraHoldMs), 0), 5000);
      }
    }
  }

  // 세그먼트 대사/화자/연기 톤/호흡 수정
  if (Array.isArray(body.segments)) {
    for (const patchSeg of body.segments) {
      const target = revision.segments.find((s) => s.segmentId === patchSeg.segmentId);
      if (!target) continue;
      if (typeof patchSeg.speakerCharacterId === 'string') {
        target.speakerCharacterId = patchSeg.speakerCharacterId;
      }
      if (typeof patchSeg.textKo === 'string') {
        target.textKo = patchSeg.textKo;
      }
      if (typeof patchSeg.textEn === 'string') {
        target.textEn = patchSeg.textEn;
      }
      if (typeof patchSeg.deliveryStyleKo === 'string') {
        target.deliveryStyleKo = patchSeg.deliveryStyleKo;
      }
      if (typeof patchSeg.deliveryStyleEn === 'string') {
        target.deliveryStyleEn = patchSeg.deliveryStyleEn;
      }
      if (patchSeg.pace) {
        target.pace = patchSeg.pace;
      }
      if (typeof patchSeg.pauseAfterMs === 'number') {
        target.pauseAfterMs = Math.min(Math.max(Math.round(patchSeg.pauseAfterMs), 0), 3000);
      }
    }
  }

  // 효과음 큐 수정
  if (Array.isArray(body.soundCues)) {
    for (const patchCue of body.soundCues) {
      const target = revision.soundCues.find((c) => c.cueId === patchCue.cueId);
      if (!target) continue;
      if (patchCue.soundAssetId !== undefined) {
        target.soundAssetId = patchCue.soundAssetId || undefined;
      }
      if (patchCue.fallbackMode) {
        target.fallbackMode = patchCue.fallbackMode;
      }
      if (typeof patchCue.gainDb === 'number') {
        target.gainDb = Math.min(Math.max(patchCue.gainDb, -24), 6);
      }
      if (typeof patchCue.meaningKo === 'string') {
        target.meaningKo = patchCue.meaningKo;
      }
      if (typeof patchCue.meaningEn === 'string') {
        target.meaningEn = patchCue.meaningEn;
      }
    }
  }

  // 모든 세그먼트의 최신 inputHash 재계산 (변경된 세그먼트만 선택적 재생성되도록 보장)
  let staleSegmentCount = 0;
  for (const seg of revision.segments) {
    const speaker = revision.characters.find((c) => c.characterId === seg.speakerCharacterId);
    const nextHashKo = computeSegmentAudioInputHash({
      segment: seg,
      character: speaker,
      locale: 'ko',
    });
    const nextHashEn = computeSegmentAudioInputHash({
      segment: seg,
      character: speaker,
      locale: 'en',
    });
    seg.inputHashByLocale.ko = nextHashKo;
    seg.inputHashByLocale.en = nextHashEn;

    const currentKoAsset = revision.audioAssets.find(
      (a) => a.audioAssetId === seg.audioAssetIdByLocale.ko,
    );
    const currentEnAsset = revision.audioAssets.find(
      (a) => a.audioAssetId === seg.audioAssetIdByLocale.en,
    );
    if (
      (currentKoAsset && currentKoAsset.inputHash !== nextHashKo) ||
      (currentEnAsset && currentEnAsset.inputHash !== nextHashEn)
    ) {
      staleSegmentCount += 1;
    }
  }

  revision.updatedAt = new Date().toISOString();
  episode.characterCount = revision.characters.length;
  episode.updatedAt = revision.updatedAt;
  await saveRevision(revision);
  await saveEpisode(episode);

  return NextResponse.json({
    episode,
    revision,
    staleSegmentCount,
  });
}

// 등록된 원고 삭제 (패스워드 7057 필수 검증)
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const providedPassword = (
    body.password ||
    req.headers.get('x-delete-password') ||
    ''
  ).trim();
  const expectedPassword = (process.env.EPISODE_DELETE_PASSWORD || '7057').trim();

  if (!providedPassword || providedPassword !== expectedPassword) {
    return NextResponse.json(
      { error: '원고 삭제 비밀번호가 올바르지 않습니다.' },
      { status: 403 },
    );
  }

  const deleted = await deleteEpisode(episodeId);
  if (!deleted) {
    return NextResponse.json({ error: '삭제할 에피소드를 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({
    deleted: true,
    episodeId,
  });
}

