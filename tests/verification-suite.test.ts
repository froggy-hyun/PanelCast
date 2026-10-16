import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import {
  buildAnalysisTilesFromStrips,
  mergeAndDeduplicateTileResults,
  verifyCoordinateCoverage,
  verifyImageMagicBytes,
} from '../src/lib/tiling';
import {
  ENSURED_SOUND_LIBRARY,
  ensureSoundLibraryLoaded,
  resolveSoundEffectAsset,
} from '../src/lib/sound-library';
import { inspectWavBuffer } from '../src/lib/audio-utils';
import {
  PREBUILT_VOICES,
  reconcileEpisodeCast,
  resolveSpeakerDisplayNameAtPanel,
} from '../src/lib/cast';
import {
  buildPlaybackManifestForLocale,
  computeSegmentAudioInputHash,
  repairRecoverableValidationIssuesOnce,
  validateRevisionForPublish,
} from '../src/lib/validation';
import {
  createEpisodeWithManuscript,
  analyzeEpisodeRevisionTiles,
  synthesizeRevisionAudio,
  validateAndFinalizeRevision,
} from '../src/lib/pipeline';
import {
  cloneRevisionAsEditableDraft,
  getEpisode,
  getManifest,
  getPaginatedManifestSlice,
  getRevision,
  publishRevisionAtomically,
  recordAudioAssetWithInputHashGuard,
  saveRevision,
} from '../src/lib/store';
import { claimTaskLease, completeTask, enqueueIdempotentTask } from '../src/lib/tasks';
import { verifyPublisherRequest, verifyPrivateWorkerRequest } from '../src/lib/auth';
import type { DeduplicatedPanel, SourceImage, TileAnalysisResult } from '../src/lib/types';
import { NextRequest } from 'next/server';

process.env.PANELCAST_SYNTH_FALLBACK_ONLY = 'true';

async function createSyntheticStripBuffer(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe('PanelCast Verification Suite (T01 - T18)', () => {
  beforeAll(async () => {
    await ensureSoundLibraryLoaded();
  });

  it('T01: Multi-strip long-scroll tiling, global Y coordinate continuity, and overlap deduplication', () => {
    const strips: SourceImage[] = [
      {
        sourceImageId: 'src_001',
        episodeId: 'ep_t01',
        revisionId: 'rev_t01',
        orderIndex: 0,
        filename: '01.jpg',
        mimeType: 'image/jpeg',
        byteSize: 10000,
        sha256: 'hash1',
        width: 690,
        height: 1600,
        globalYStart: 0,
        globalYEnd: 1600,
        storageUri: 'local://src_001.jpg',
      },
      {
        sourceImageId: 'src_002',
        episodeId: 'ep_t01',
        revisionId: 'rev_t01',
        orderIndex: 1,
        filename: '02.jpg',
        mimeType: 'image/jpeg',
        byteSize: 10000,
        sha256: 'hash2',
        width: 690,
        height: 1600,
        globalYStart: 1600,
        globalYEnd: 3200,
        storageUri: 'local://src_002.jpg',
      },
      {
        sourceImageId: 'src_003',
        episodeId: 'ep_t01',
        revisionId: 'rev_t01',
        orderIndex: 2,
        filename: '03.jpg',
        mimeType: 'image/jpeg',
        byteSize: 10000,
        sha256: 'hash3',
        width: 690,
        height: 1600,
        globalYStart: 3200,
        globalYEnd: 4800,
        storageUri: 'local://src_003.jpg',
      },
    ];

    const tiles = buildAnalysisTilesFromStrips('ep_t01', 'rev_t01', strips, {
      tileHeightPx: 2400,
      overlapPx: 360,
    });
    expect(tiles.length).toBeGreaterThanOrEqual(2);

    const coverage = verifyCoordinateCoverage(strips, tiles);
    expect(coverage.valid).toBe(true);
    expect(coverage.errors).toHaveLength(0);

    // 오버랩 구간(2040..2400)에 걸친 동일 컷이 중복 제거되는지 확인
    const tile0Result: TileAnalysisResult = {
      panels: [
        {
          localPanelIndex: 0,
          bbox: { x: 20, y: 100, width: 960, height: 300 },
          visualSummaryKo: '첫 번째 컷 장면입니다.',
          visualSummaryEn: 'First cut scene.',
          emotionalToneKo: '차분함',
          emotionalToneEn: 'Calm',
          continuityNote: 'Cut 1',
          segments: [
            {
              kind: 'dialogue',
              speakerKey: 'jinhyuk',
              speakerNameKo: '강진혁',
              speakerNameEn: 'Kang Jinhyuk',
              textKo: '드디어 시작이군.',
              textEn: 'It finally begins.',
              deliveryStyleKo: '단호하게',
              deliveryStyleEn: 'Firmly',
            },
          ],
        },
        {
          // globalYStart = 0 + 0.88 * 2400 = 2112 (오버랩 구간)
          localPanelIndex: 1,
          bbox: { x: 20, y: 880, width: 960, height: 100 },
          visualSummaryKo: '경계선에 걸친 두 번째 컷 장면입니다.',
          visualSummaryEn: 'Second cut across tile overlap.',
          emotionalToneKo: '긴박함',
          emotionalToneEn: 'Urgent',
          continuityNote: 'Cut 2',
          segments: [
            {
              kind: 'dialogue',
              speakerKey: 'jinhyuk',
              speakerNameKo: '강진혁',
              speakerNameEn: 'Kang Jinhyuk',
              textKo: '경계선 대사입니다.',
              textEn: 'Overlap dialogue line.',
              deliveryStyleKo: '낮은 목소리',
              deliveryStyleEn: 'Low voice',
            },
          ],
        },
      ],
    };

    const tile1Result: TileAnalysisResult = {
      panels: [
        {
          // tile[1].globalYStart = 2040 -> 2040 + 0.03 * 2400 = 2112 (동일 컷 중복 감지)
          localPanelIndex: 0,
          bbox: { x: 20, y: 30, width: 960, height: 100 },
          visualSummaryKo: '경계선에 걸친 두 번째 컷 장면입니다.',
          visualSummaryEn: 'Second cut across tile overlap.',
          emotionalToneKo: '긴박함',
          emotionalToneEn: 'Urgent',
          continuityNote: 'Cut 2 duplicate',
          segments: [
            {
              kind: 'dialogue',
              speakerKey: 'jinhyuk',
              speakerNameKo: '강진혁',
              speakerNameEn: 'Kang Jinhyuk',
              textKo: '경계선 대사입니다.',
              textEn: 'Overlap dialogue line.',
              deliveryStyleKo: '낮은 목소리',
              deliveryStyleEn: 'Low voice',
            },
          ],
        },
      ],
    };

    const merged = mergeAndDeduplicateTileResults([
      { tile: tiles[0], result: tile0Result },
      { tile: tiles[1], result: tile1Result },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('T02: Verified sound library matching and low-confidence spoken narration fallback', () => {
    expect(ENSURED_SOUND_LIBRARY.length).toBeGreaterThanOrEqual(8);
    for (const sfx of ENSURED_SOUND_LIBRARY) {
      expect(sfx.sha256.length).toBe(64);
      expect(sfx.byteSize).toBeGreaterThan(44);
      expect(sfx.durationMs).toBeGreaterThan(100);
    }

    const highConfidenceMatch = resolveSoundEffectAsset({
      rawTextKo: '콰아앙!',
      meaningKo: '거대한 폭발음',
      meaningEn: 'Massive explosion',
      suggestedCategory: 'impact_heavy',
      confidence: 0.92,
    });
    expect(highConfidenceMatch.fallbackMode).toBe('sound_effect');
    expect(highConfidenceMatch.asset?.soundAssetId).toBeDefined();

    const lowConfidenceFallback = resolveSoundEffectAsset({
      rawTextKo: '스르륵...',
      meaningKo: '애매한 기척',
      meaningEn: 'Faint rustle',
      suggestedCategory: 'unknown_category',
      confidence: 0.45,
    });
    expect(lowConfidenceFallback.fallbackMode).toBe('text_only');
    expect(lowConfidenceFallback.asset).toBeUndefined();
  });

  it('T03: Multi-character voice differentiation, spoiler-safe identity masking, and voice pool overflow handling', () => {
    const mockPanels: DeduplicatedPanel[] = [
      {
        sourceTileIndex: 0,
        globalYStart: 0,
        globalYEnd: 500,
        bbox: { x: 0, y: 0, width: 1000, height: 500 },
        visualSummaryKo: '어둠 속에서 낯선 그림자가 말한다.',
        visualSummaryEn: 'A stranger speaks from the shadows.',
        emotionalToneKo: '신비로움',
        emotionalToneEn: 'Mysterious',
        continuityNote: '',
        segments: [
          {
            kind: 'dialogue',
            speakerKey: 'mystery_boss',
            speakerNameKo: '성좌의 감시자',
            speakerNameEn: 'Watcher of Constellations',
            isIdentityRevealedInThisCut: false,
            unrevealedLabelKo: '정체불명의 목소리',
            unrevealedLabelEn: 'Mysterious Voice',
            genderHint: 'male',
            textKo: '네가 탑을 오를 자격이 있는지 보겠다.',
            textEn: 'Let us see if you are worthy of climbing the tower.',
            deliveryStyleKo: '울림 있는 목소리',
            deliveryStyleEn: 'Resonant voice',
          },
        ],
      },
      {
        sourceTileIndex: 0,
        globalYStart: 500,
        globalYEnd: 1000,
        bbox: { x: 0, y: 500, width: 1000, height: 500 },
        visualSummaryKo: '빛이 걷히며 성좌의 감시자가 본모습을 드러낸다.',
        visualSummaryEn: 'The light clears and the Watcher of Constellations reveals his identity.',
        emotionalToneKo: '위압감',
        emotionalToneEn: 'Imposing',
        continuityNote: '',
        segments: [
          {
            kind: 'dialogue',
            speakerKey: 'mystery_boss',
            speakerNameKo: '성좌의 감시자',
            speakerNameEn: 'Watcher of Constellations',
            isIdentityRevealedInThisCut: true,
            unrevealedLabelKo: '정체불명의 목소리',
            unrevealedLabelEn: 'Mysterious Voice',
            genderHint: 'male',
            textKo: '내 이름은 성좌의 감시자다.',
            textEn: 'I am the Watcher of Constellations.',
            deliveryStyleKo: '위엄 있게',
            deliveryStyleEn: 'Majestically',
          },
          // 9명의 추가 캐릭터를 투입하여 8종 프리빌트 보이스 풀 초과 유도
          ...Array.from({ length: 9 }).map((_, idx) => ({
            kind: 'dialogue' as const,
            speakerKey: `extra_char_${idx}`,
            speakerNameKo: `도전자 ${idx + 1}`,
            speakerNameEn: `Challenger ${idx + 1}`,
            isIdentityRevealedInThisCut: true,
            genderHint: (idx % 2 === 0 ? 'male' : 'female') as 'male' | 'female',
            textKo: `대사 ${idx + 1}`,
            textEn: `Line ${idx + 1}`,
            deliveryStyleKo: '평범하게',
            deliveryStyleEn: 'Normally',
          })),
        ],
      },
    ];

    const castResult = reconcileEpisodeCast({
      episodeId: 'ep_t03',
      revisionId: 'rev_t03',
      panels: mockPanels,
    });

    expect(castResult.voicePoolExhausted).toBe(true);
    expect(castResult.characters.length).toBeGreaterThan(PREBUILT_VOICES.length);

    const bossCharId = castResult.speakerKeyToCharacterId['mystery_boss'];
    const bossChar = castResult.characters.find((c) => c.characterId === bossCharId);
    expect(bossChar?.revealedAtPanelId).toBe('panel_002');

    const panelEntities = [
      { panelId: 'panel_001', orderIndex: 0 },
      { panelId: 'panel_002', orderIndex: 1 },
    ] as any;

    // 컷 0에서는 스포일러 방지를 위해 미공개 호칭 노출
    expect(
      resolveSpeakerDisplayNameAtPanel({
        character: bossChar,
        panelOrderIndex: 0,
        panels: panelEntities,
        locale: 'ko',
      }),
    ).toBe('정체불명의 목소리');

    // 컷 1(공개 시점)부터는 실명 노출
    expect(
      resolveSpeakerDisplayNameAtPanel({
        character: bossChar,
        panelOrderIndex: 1,
        panels: panelEntities,
        locale: 'ko',
      }),
    ).toBe('성좌의 감시자');
  });

  it('T04, T05, T06, T07, T08, T09, T10, T15, T17, T18: Full pipeline lifecycle, idempotency, selective regen, draft isolation, auto-repair, bilingual manifests, stale guard, and pagination', async () => {
    const strip1 = await createSyntheticStripBuffer(690, 1200, { r: 24, g: 28, b: 36 });
    const strip2 = await createSyntheticStripBuffer(690, 1200, { r: 36, g: 42, b: 54 });

    // T06: 접근성 커스텀(custom) 모드로 생성 시 자동 게시되지 않고 ready 상태에서 멈춤
    const { episode, revision } = await createEpisodeWithManuscript({
      episodeId: `ep_test_lifecycle_${Date.now().toString(36)}`,
      titleKo: '테스트 웹툰 1화',
      titleEn: 'Test Webtoon Ep. 1',
      summaryKo: '검증용 에피소드 요약',
      summaryEn: 'Verification episode summary',
      authorName: '테스트 작가',
      publishMode: 'custom',
      files: [
        { filename: '01.jpg', buffer: strip1 },
        { filename: '02.jpg', buffer: strip2 },
      ],
    });

    expect(episode.sourceImageCount).toBe(2);
    expect(episode.totalStitchedHeight).toBe(2400);

    // T15: 태스크 멱등성 검증 (동일 파라미터로 2회 enqueue 시 기존 태스크 반환)
    const firstEnqueue = await enqueueIdempotentTask({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      taskType: 'tile_analysis',
      idempotencyKeyParts: ['idempotency_probe'],
      payload: { probe: 1 },
    });
    const secondEnqueue = await enqueueIdempotentTask({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      taskType: 'tile_analysis',
      idempotencyKeyParts: ['idempotency_probe'],
      payload: { probe: 1 },
    });
    expect(firstEnqueue.created).toBe(true);
    expect(secondEnqueue.created).toBe(false);
    expect(secondEnqueue.task.taskId).toBe(firstEnqueue.task.taskId);

    const leased = await claimTaskLease(firstEnqueue.task);
    expect(leased).not.toBeNull();
    await completeTask(leased!, 'succeeded');
    const duplicateClaimAfterComplete = await claimTaskLease(firstEnqueue.task);
    expect(duplicateClaimAfterComplete).toBeNull();

    // T04: 타일 분석 실행 (모의 분석기 주입)
    const analyzed = await analyzeEpisodeRevisionTiles({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      tileAnalyzerOverride: async (tileIndex) => ({
        latencyMs: 12,
        modelId: 'test-vision-override',
        result: {
          panels: [
            {
              localPanelIndex: 0,
              bbox: { x: 10, y: 50, width: 980, height: 420 },
              visualSummaryKo: `${tileIndex + 1}번 타일 첫 장면: 주인공이 검을 뽑아든다.`,
              visualSummaryEn: `Tile ${tileIndex + 1} scene 1: The protagonist draws his blade.`,
              emotionalToneKo: '결연함',
              emotionalToneEn: 'Resolute',
              continuityNote: 'Scene 1',
              segments: [
                {
                  kind: 'dialogue',
                  speakerKey: 'kang_jinhyuk',
                  speakerNameKo: '강진혁',
                  speakerNameEn: 'Kang Jinhyuk',
                  genderHint: 'male',
                  textKo: '여기서부터는 내가 공략한다.',
                  textEn: 'From here on, I lead the raid.',
                  deliveryStyleKo: '자신감 넘치게',
                  deliveryStyleEn: 'Confidently',
                },
                {
                  kind: 'system_popup',
                  speakerKey: 'system',
                  speakerNameKo: '시스템 알림',
                  speakerNameEn: 'System Window',
                  textKo: '[고유 스킬이 발동되었습니다.]',
                  textEn: '[Unique skill has been activated.]',
                  deliveryStyleKo: '명료한 안내음',
                  deliveryStyleEn: 'Clear system chime',
                },
              ],
            },
          ],
        },
      }),
    });

    expect(analyzed.revision.panels.length).toBeGreaterThanOrEqual(1);
    expect(analyzed.revision.segments.length).toBeGreaterThanOrEqual(2);

    // 최초 전체 오디오 합성
    const firstSynth = await synthesizeRevisionAudio({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
    });
    expect(firstSynth.synthesizedCount).toBeGreaterThan(0);

    // T09: 고의로 마지막 패널의 세그먼트를 비워 검증 실패 유도 후 1회 자동 보정 루프 검증
    const revBeforeValidate = await getRevision(episode.episodeId, revision.revisionId);
    expect(revBeforeValidate).not.toBeNull();
    revBeforeValidate!.panels.push({
      panelId: 'panel_empty_probe',
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      orderIndex: revBeforeValidate!.panels.length,
      sourceTileId: revBeforeValidate!.tiles[0].tileId,
      sourceImageId: revBeforeValidate!.sourceImages[0].sourceImageId,
      globalYStart: 2000,
      globalYEnd: 2400,
      bbox: { x: 0, y: 800, width: 1000, height: 200 },
      visualSummaryKo: '정적만이 흐르는 복도 끝.',
      visualSummaryEn: 'The silent end of the corridor.',
      emotionalToneKo: '고요함',
      emotionalToneEn: 'Silent',
      continuityNote: 'Auto-repair probe panel',
      extraHoldMs: 300,
      segmentIds: [], // 고의 누락: 세그먼트가 0개인 패널
      soundCueIds: [],
    });
    await saveRevision(revBeforeValidate!);

    // 검증 및 자동 보정 실행 (custom 모드이므로 자동 게시되지 않음: T06)
    const finalizedCustom = await validateAndFinalizeRevision({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      autoPublishIfValid: false,
    });

    expect(finalizedCustom.initialReport.valid).toBe(false);
    expect(finalizedCustom.autoCorrectionNotes.length).toBeGreaterThan(0);
    expect(finalizedCustom.finalReport.valid).toBe(true);
    expect(finalizedCustom.published).toBe(false);
    expect(finalizedCustom.episode.publishedRevisionId).toBeUndefined();

    // T07: 특정 세그먼트 1개만 대사 수정 후 선택적 재생성 시 수정된 세그먼트만 합성되고 나머지는 재사용됨을 검증
    const revForSelective = await getRevision(episode.episodeId, revision.revisionId);
    const targetSeg = revForSelective!.segments[0];
    targetSeg.textKo = '수정한 대사: 이제 진짜 시작이다!';
    await saveRevision(revForSelective!);

    const secondSynth = await synthesizeRevisionAudio({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
    });
    expect(secondSynth.synthesizedCount).toBe(1); // ko 대사만 변경되었으므로 ko 1건만 재생성!
    expect(secondSynth.reusedCount).toBeGreaterThanOrEqual(3);

    // T17: Stale 작업 덮어쓰기 방지 가드 검증
    const guardRejection = await recordAudioAssetWithInputHashGuard({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      segmentId: targetSeg.segmentId,
      locale: 'ko',
      expectedInputHash: 'stale_hash_from_old_worker_0000',
      asset: {
        audioAssetId: 'aud_stale_should_not_apply',
        episodeId: episode.episodeId,
        revisionId: revision.revisionId,
        segmentId: targetSeg.segmentId,
        locale: 'ko',
        voiceName: 'Kore',
        inputHash: 'stale_hash_from_old_worker_0000',
        mimeType: 'audio/wav',
        byteSize: 1000,
        durationMs: 500,
        sampleRateHz: 24000,
        sha256: 'stale',
        storageUri: 'local://stale.wav',
        createdAt: new Date().toISOString(),
      },
    });
    expect(guardRejection.applied).toBe(false);
    expect(guardRejection.reason).toContain('Stale task output rejected');

    // T05: 재검증 및 원자적 게시
    const publishedOutcome = await validateAndFinalizeRevision({
      episodeId: episode.episodeId,
      revisionId: revision.revisionId,
      autoPublishIfValid: true,
    });
    expect(publishedOutcome.published).toBe(true);
    expect(publishedOutcome.episode.publishedRevisionId).toBe(revision.revisionId);

    // T10: 한/영 이중 언어 매니페스트 정합성 확인
    const koManifest = await getManifest(episode.episodeId, revision.revisionId, 'ko');
    const enManifest = await getManifest(episode.episodeId, revision.revisionId, 'en');
    expect(koManifest).not.toBeNull();
    expect(enManifest).not.toBeNull();
    expect(koManifest!.locale).toBe('ko');
    expect(enManifest!.locale).toBe('en');
    expect(koManifest!.panels[0].segments[0].text).not.toBe(
      enManifest!.panels[0].segments[0].text,
    );

    // T18: 매니페스트 커서 페이지네이션 검증
    const page1 = getPaginatedManifestSlice({
      manifest: koManifest!,
      limit: 1,
    });
    expect(page1.panels).toHaveLength(1);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe('1');

    const page2 = getPaginatedManifestSlice({
      manifest: koManifest!,
      cursor: page1.nextCursor,
      limit: 1,
    });
    expect(page2.panels).toHaveLength(1);
    expect(page2.panels[0].panelId).not.toBe(page1.panels[0].panelId);

    expect(koManifest!.panels[0].highContrastImageUrl).toContain('?contrast=high');

    // T08: 기공개 에피소드 무중단 재편집(Draft Isolation)
    const clonedDraft = await cloneRevisionAsEditableDraft(
      episode.episodeId,
      revision.revisionId,
    );
    expect(clonedDraft.revisionId).not.toBe(revision.revisionId);
    const epDuringDraft = await getEpisode(episode.episodeId);
    // 독자용 publishedRevisionId는 여전히 기존 리비전을 가리켜야 함
    expect(epDuringDraft!.publishedRevisionId).toBe(revision.revisionId);
    expect(epDuringDraft!.activeDraftRevisionId).toBe(clonedDraft.revisionId);
  });

  it('T13 & T16: Open MVP publisher access, invalid token guard, worker auth guard, and magic-byte defense', async () => {
    // T16: 위조된 이미지 바이트 거부
    const fakeJpg = Buffer.from('<!DOCTYPE html><html><body>not an image</body></html>', 'utf8');
    const magicResult = verifyImageMagicBytes(fakeJpg);
    expect(magicResult.valid).toBe(false);

    const realJpg = await createSyntheticStripBuffer(100, 100, { r: 200, g: 100, b: 50 });
    expect(verifyImageMagicBytes(realJpg).valid).toBe(true);

    // MVP 개방형 원고 등록 허용 및 명시적 오타 토큰/토큰 강제 옵션 검증
    const openMvpReq = new NextRequest('http://localhost:3000/api/studio/episodes', {
      method: 'POST',
    });
    expect(verifyPublisherRequest(openMvpReq).authorized).toBe(true);
    expect(verifyPublisherRequest(openMvpReq, { requireToken: true }).authorized).toBe(false);

    const badTokenReq = new NextRequest('http://localhost:3000/api/studio/episodes', {
      method: 'POST',
      headers: {
        'x-publisher-token': 'invalid-token-value',
      },
    });
    expect(verifyPublisherRequest(badTokenReq).authorized).toBe(false);

    const unauthWorkerReq = new NextRequest('http://localhost:3000/api/worker/execute', {
      method: 'POST',
      headers: {
        'x-cloudtasks-queuename': 'panelcast-episode-queue',
      },
    });
    const workerAuth = await verifyPrivateWorkerRequest(unauthWorkerReq);
    expect(workerAuth.authorized).toBe(false);
    expect(workerAuth.status).toBe(403);
  });
});
