'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  Character,
  Episode,
  EpisodeTask,
  Panel,
  Revision,
  Segment,
  SoundAsset,
  SoundCue,
} from '@/lib/types';

interface PrebuiltVoiceOption {
  voiceName: string;
  genderHint: string;
  timbreKo: string;
  timbreEn: string;
}

export default function StudioCustomizationPage() {
  const params = useParams<{ episodeId: string }>();
  const router = useRouter();
  const episodeId = params.episodeId;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [tasks, setTasks] = useState<EpisodeTask[]>([]);
  const [soundLibrary, setSoundLibrary] = useState<SoundAsset[]>([]);
  const [prebuiltVoices, setPrebuiltVoices] = useState<PrebuiltVoiceOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const [selectedPanelIndex, setSelectedPanelIndex] = useState(0);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  const loadStudioState = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/studio/episodes/${episodeId}`);
      if (res.status === 401 || res.status === 403) {
        setAuthNeeded(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to load studio state');
      }
      const data = (await res.json()) as {
        episode: Episode;
        revision: Revision;
        tasks: EpisodeTask[];
        soundLibrary: SoundAsset[];
        prebuiltVoices: PrebuiltVoiceOption[];
      };
      setAuthNeeded(false);
      setEpisode(data.episode);
      setRevision(data.revision);
      setTasks(data.tasks ?? []);
      setSoundLibrary(data.soundLibrary ?? []);
      setPrebuiltVoices(data.prebuiltVoices ?? []);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    void loadStudioState();
  }, [loadStudioState]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tokenInput }),
    });
    if (!res.ok) {
      setErrorMessage('출판사 인증 키가 일치하지 않습니다.');
      return;
    }
    setTokenInput('');
    await loadStudioState();
  }

  async function handleSaveCustomizations() {
    if (!revision) return;
    setBusyAction('save');
    setErrorMessage('');
    setStatusMessage('커스텀 설정 저장 및 세그먼트 해시(inputHash) 계산 중...');
    try {
      const res = await fetch(`/api/studio/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          revisionId: revision.revisionId,
          characters: revision.characters.map((c) => ({
            characterId: c.characterId,
            canonicalNameKo: c.canonicalNameKo,
            canonicalNameEn: c.canonicalNameEn,
            unrevealedLabelKo: c.unrevealedLabelKo,
            unrevealedLabelEn: c.unrevealedLabelEn,
            revealedAtPanelId: c.revealedAtPanelId ?? null,
            koVoiceName: c.voiceProfile.koVoiceName,
            enVoiceName: c.voiceProfile.enVoiceName,
            stylePromptKo: c.voiceProfile.stylePromptKo,
            stylePromptEn: c.voiceProfile.stylePromptEn,
            speakingRate: c.voiceProfile.speakingRate,
            pitchSemitones: c.voiceProfile.pitchSemitones,
          })),
          panels: revision.panels.map((p) => ({
            panelId: p.panelId,
            visualSummaryKo: p.visualSummaryKo,
            visualSummaryEn: p.visualSummaryEn,
            emotionalToneKo: p.emotionalToneKo,
            emotionalToneEn: p.emotionalToneEn,
            extraHoldMs: p.extraHoldMs,
          })),
          segments: revision.segments.map((s) => ({
            segmentId: s.segmentId,
            speakerCharacterId: s.speakerCharacterId,
            textKo: s.textKo,
            textEn: s.textEn,
            deliveryStyleKo: s.deliveryStyleKo,
            deliveryStyleEn: s.deliveryStyleEn,
            pace: s.pace,
            pauseAfterMs: s.pauseAfterMs,
          })),
          soundCues: revision.soundCues.map((c) => ({
            cueId: c.cueId,
            soundAssetId: c.soundAssetId ?? null,
            fallbackMode: c.fallbackMode,
            gainDb: c.gainDb,
            meaningKo: c.meaningKo,
            meaningEn: c.meaningEn,
          })),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to save changes');
      }
      const data = (await res.json()) as {
        episode: Episode;
        revision: Revision;
        staleSegmentCount: number;
      };
      setEpisode(data.episode);
      setRevision(data.revision);
      setStatusMessage(
        `저장 완료. 변경되어 오디오 재생성이 필요한 세그먼트: ${data.staleSegmentCount}개`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  }

  async function handleMergeCharacters() {
    if (!revision || !mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      return;
    }
    setBusyAction('merge');
    setErrorMessage('');
    try {
      const res = await fetch(`/api/studio/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          revisionId: revision.revisionId,
          action: 'merge_characters',
          mergeSourceCharacterId: mergeSourceId,
          mergeTargetCharacterId: mergeTargetId,
        }),
      });
      if (!res.ok) throw new Error('인물 병합 실패');
      const data = (await res.json()) as { episode: Episode; revision: Revision };
      setEpisode(data.episode);
      setRevision(data.revision);
      setMergeSourceId('');
      setMergeTargetId('');
      setStatusMessage('선택한 두 등장인물이 하나로 병합되었습니다.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  }

  async function handleCreateEditableDraft() {
    setBusyAction('draft');
    setErrorMessage('');
    try {
      const res = await fetch(`/api/studio/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create_draft',
        }),
      });
      if (!res.ok) throw new Error('새 초안 리비전 생성 실패');
      const data = (await res.json()) as { episode: Episode; revision: Revision };
      setEpisode(data.episode);
      setRevision(data.revision);
      setStatusMessage(
        `공개본에 영향을 주지 않는 새 편집 초안(${data.revision.revisionId})이 생성되었습니다.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  }

  async function handleRunJob(
    action: 'analyze' | 'synthesize' | 'validate' | 'reconcile_tasks' | 'cancel',
  ) {
    if (!revision) return;
    setBusyAction(action);
    setErrorMessage('');
    setStatusMessage(`작업 실행 중: ${action}...`);
    try {
      if (action === 'synthesize' || action === 'validate') {
        await handleSaveCustomizations();
      }
      const res = await fetch(`/api/studio/episodes/${episodeId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          revisionId: revision.revisionId,
          action,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Job ${action} failed`);
      }
      const data = (await res.json()) as {
        synthesizedCount?: number;
        reusedCount?: number;
        recoveredCount?: number;
        cancelledCount?: number;
      };
      await loadStudioState();
      if (action === 'synthesize') {
        setStatusMessage(
          `선택적 음성 재생성 완료: 신규 합성 ${data.synthesizedCount ?? 0}건, 변경 없는 기존 오디오 재사용 ${data.reusedCount ?? 0}건`,
        );
      } else if (action === 'reconcile_tasks') {
        setStatusMessage(`작업 큐 점검 완료: 복구된 작업 ${data.recoveredCount ?? 0}건`);
      } else if (action === 'cancel') {
        setStatusMessage(`진행 중인 작업 ${data.cancelledCount ?? 0}건 취소됨`);
      } else {
        setStatusMessage(`작업(${action})이 완료되었습니다.`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  }

  async function handleAtomicPublish() {
    if (!revision) return;
    setBusyAction('publish');
    setErrorMessage('');
    setStatusMessage('최종 검증 및 원자적 게시(Atomic Publish) 실행 중...');
    try {
      await handleSaveCustomizations();
      const res = await fetch(`/api/studio/episodes/${episodeId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: revision.revisionId }),
      });
      const data = (await res.json()) as {
        error?: string;
        episode?: Episode;
        revision?: Revision;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Publish validation failed');
      }
      if (data.episode) setEpisode(data.episode);
      if (data.revision) setRevision(data.revision);
      setStatusMessage(
        `리비전 ${revision.revisionId} 게시가 완료되었습니다! 독자 리더에서 즉시 감상할 수 있습니다.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  }

  function updateCharacter(charId: string, updater: (c: Character) => Character) {
    if (!revision) return;
    setRevision({
      ...revision,
      characters: revision.characters.map((c) =>
        c.characterId === charId ? updater(structuredClone(c)) : c,
      ),
    });
  }

  function updatePanel(panelId: string, updater: (p: Panel) => Panel) {
    if (!revision) return;
    setRevision({
      ...revision,
      panels: revision.panels.map((p) =>
        p.panelId === panelId ? updater(structuredClone(p)) : p,
      ),
    });
  }

  function updateSegment(segId: string, updater: (s: Segment) => Segment) {
    if (!revision) return;
    setRevision({
      ...revision,
      segments: revision.segments.map((s) =>
        s.segmentId === segId ? updater(structuredClone(s)) : s,
      ),
    });
  }

  function updateSoundCue(cueId: string, updater: (c: SoundCue) => SoundCue) {
    if (!revision) return;
    setRevision({
      ...revision,
      soundCues: revision.soundCues.map((c) =>
        c.cueId === cueId ? updater(structuredClone(c)) : c,
      ),
    });
  }

  if (loading) {
    return (
      <main id="main-content" className="max-w-6xl mx-auto p-8">
        스튜디오 데이터를 불러오는 중입니다...
      </main>
    );
  }

  if (authNeeded) {
    return (
      <main id="main-content" className="max-w-md mx-auto p-8 space-y-4">
        <h1 className="text-2xl font-bold">출판사 스튜디오 인증 필요</h1>
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          접근성 커스텀 스튜디오는 인증된 작가 및 출판사만 접근할 수 있습니다.
        </p>
        <form onSubmit={handleLogin} className="space-y-3">
          <label htmlFor="studio-token" className="block text-sm font-semibold">
            인증 토큰
          </label>
          <input
            id="studio-token"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="touch-target w-full px-3 py-2 border rounded"
          />
          <button
            type="submit"
            className="touch-target px-5 py-2.5 rounded font-semibold text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--accent-vermilion)', color: '#ffffff' }}
          >
            인증하기
          </button>
        </form>
        {errorMessage && (
          <p role="alert" className="text-sm font-semibold" style={{ color: 'var(--accent-vermilion)' }}>
            {errorMessage}
          </p>
        )}
      </main>
    );
  }

  if (!episode || !revision) {
    return (
      <main id="main-content" className="max-w-4xl mx-auto p-8 space-y-4">
        <h1 className="text-xl font-bold">에피소드를 찾을 수 없습니다.</h1>
        <Link href="/" className="underline">
          홈으로 돌아가기
        </Link>
      </main>
    );
  }

  const activePanel = revision.panels[selectedPanelIndex];
  const panelSegments = activePanel
    ? revision.segments.filter((s) => s.panelId === activePanel.panelId)
    : [];
  const panelCues = activePanel
    ? revision.soundCues.filter((c) => c.panelId === activePanel.panelId)
    : [];

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--bg-paper)', color: 'var(--ink-primary)' }}
    >
      {/* 상단 스튜디오 워크벤치 바 */}
      <header
        className="border-b sticky top-0 z-20"
        style={{
          borderColor: 'var(--border-hairline)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="touch-target inline-flex items-center px-3 py-1.5 border rounded text-xs font-semibold no-underline"
              style={{ borderColor: 'var(--border-hairline)', color: 'var(--ink-primary)' }}
            >
              ← 서재 / 데스크
            </Link>
            <div>
              <h1 className="text-lg font-bold leading-snug">
                접근성 커스텀 스튜디오: {episode.titleKo}
              </h1>
              <p className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                작업 리비전: {revision.revisionId} ({revision.status}) · 공개 리비전:{' '}
                {episode.publishedRevisionId || '미공개'} · 총 {revision.panels.length}컷 · 등장인물{' '}
                {revision.characters.length}명
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {revision.status === 'published' && (
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handleCreateEditableDraft}
                className="touch-target px-3.5 py-2 border rounded text-xs font-semibold cursor-pointer"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                새 편집 초안(Draft) 복제 생성
              </button>
            )}

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleSaveCustomizations}
              className="touch-target px-4 py-2 border rounded text-xs font-semibold cursor-pointer"
              style={{
                borderColor: 'var(--border-strong)',
                backgroundColor: 'var(--bg-paper)',
              }}
            >
              1. 커스텀 설정 저장
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => handleRunJob('synthesize')}
              className="touch-target px-4 py-2 border rounded text-xs font-semibold cursor-pointer"
              style={{
                borderColor: 'var(--accent-pine)',
                backgroundColor: 'var(--accent-pine)',
                color: '#ffffff',
              }}
            >
              2. 변경된 대사만 선택 음성 합성
            </button>

            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleAtomicPublish}
              className="touch-target px-5 py-2 rounded text-xs font-bold cursor-pointer"
              style={{
                backgroundColor: 'var(--accent-vermilion)',
                color: '#ffffff',
              }}
            >
              3. 검증 및 원자적 게시 (Publish)
            </button>

            {episode.publishedRevisionId && (
              <button
                type="button"
                onClick={() => router.push(`/read/${episode.episodeId}`)}
                className="touch-target px-3.5 py-2 border rounded text-xs font-semibold cursor-pointer"
                style={{ borderColor: 'var(--border-hairline)' }}
              >
                독자 리더 열기 →
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* 상태 및 경고 알림줄 */}
        {(statusMessage || errorMessage || revision.voicePoolExhausted) && (
          <div className="space-y-2">
            {statusMessage && (
              <div
                role="status"
                className="p-3.5 border rounded text-sm font-medium"
                style={{
                  borderColor: 'var(--accent-pine)',
                  backgroundColor: 'var(--bg-card)',
                }}
              >
                {statusMessage}
              </div>
            )}
            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 border rounded text-sm font-semibold"
                style={{
                  borderColor: 'var(--accent-vermilion)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--accent-vermilion)',
                }}
              >
                {errorMessage}
              </div>
            )}
            {revision.voicePoolExhausted && (
              <div
                role="alert"
                data-testid="voice-pool-exhausted-banner"
                className="p-3.5 border rounded text-xs font-semibold"
                style={{
                  borderColor: 'var(--accent-vermilion)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              >
                [보이스 풀 초과 안내] 현재 에피소드의 등장인물({revision.characters.length}명)이 기본 성우 보이스 풀({prebuiltVoices.length}종)을 초과하여 일부 조연에게 속도·피치·연기 톤이 차별화된 공유 보이스가 자동 배정되었습니다. 아래 표에서 원하는 보이스로 직접 변경할 수 있습니다.
              </div>
            )}
          </div>
        )}

        {/* 섹션 1: 다중 등장인물 보이스 캐스팅 및 스포일러 보호 설정 */}
        <section
          aria-labelledby="cast-section-heading"
          className="p-6 border rounded space-y-5"
          style={{
            borderColor: 'var(--border-hairline)',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="cast-section-heading" className="text-xl font-bold">
                등장인물 보이스 캐스팅 및 스포일러 보호 설정 ({revision.characters.length}명)
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-secondary)' }}>
                2인 화자 제한 없이 모든 인물에 개별 보이스와 연기 톤을 지정합니다. 정체가 나중에 밝혀지는 인물은 공개 컷(Revealed At Cut) 이전까지 미공개 호칭으로 낭독됩니다.
              </p>
            </div>

            {/* 인물 병합 도구 */}
            {revision.characters.length >= 2 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor="merge-src" className="font-semibold">
                  인물 병합:
                </label>
                <select
                  id="merge-src"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="touch-target px-2.5 py-1.5 border rounded"
                  style={{ borderColor: 'var(--border-hairline)' }}
                >
                  <option value="">병합할 인물 선택</option>
                  {revision.characters.map((c) => (
                    <option key={c.characterId} value={c.characterId}>
                      {c.canonicalNameKo} ({c.characterId})
                    </option>
                  ))}
                </select>
                <span>→</span>
                <select
                  aria-label="병합 대상 인물 선택"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="touch-target px-2.5 py-1.5 border rounded"
                  style={{ borderColor: 'var(--border-hairline)' }}
                >
                  <option value="">기준 인물 선택</option>
                  {revision.characters.map((c) => (
                    <option key={c.characterId} value={c.characterId}>
                      {c.canonicalNameKo} ({c.characterId})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleMergeCharacters}
                  className="touch-target px-3 py-1.5 border rounded font-semibold cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)' }}
                >
                  병합 적용
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {revision.characters.map((char) => (
              <div
                key={char.characterId}
                className="p-4 border rounded space-y-3"
                style={{
                  borderColor: 'var(--border-hairline)',
                  backgroundColor: 'var(--bg-paper)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    aria-label={`${char.canonicalNameKo} 한국어 이름`}
                    value={char.canonicalNameKo}
                    onChange={(e) =>
                      updateCharacter(char.characterId, (c) => ({
                        ...c,
                        canonicalNameKo: e.target.value,
                      }))
                    }
                    className="font-bold text-sm px-2 py-1 border rounded w-1/2"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                  <input
                    type="text"
                    aria-label={`${char.canonicalNameEn} 영어 이름`}
                    value={char.canonicalNameEn}
                    onChange={(e) =>
                      updateCharacter(char.characterId, (c) => ({
                        ...c,
                        canonicalNameEn: e.target.value,
                      }))
                    }
                    className="text-xs px-2 py-1 border rounded w-1/2"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label
                      htmlFor={`voice-ko-${char.characterId}`}
                      className="block font-semibold mb-1"
                    >
                      한국어 성우 보이스
                    </label>
                    <select
                      id={`voice-ko-${char.characterId}`}
                      value={char.voiceProfile.koVoiceName}
                      onChange={(e) =>
                        updateCharacter(char.characterId, (c) => ({
                          ...c,
                          voiceProfile: {
                            ...c.voiceProfile,
                            koVoiceName: e.target.value,
                          },
                        }))
                      }
                      className="touch-target w-full px-2 py-1.5 border rounded"
                      style={{ borderColor: 'var(--border-hairline)' }}
                    >
                      {prebuiltVoices.map((v) => (
                        <option key={v.voiceName} value={v.voiceName}>
                          {v.voiceName} ({v.timbreKo})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`voice-en-${char.characterId}`}
                      className="block font-semibold mb-1"
                    >
                      영어 성우 보이스
                    </label>
                    <select
                      id={`voice-en-${char.characterId}`}
                      value={char.voiceProfile.enVoiceName}
                      onChange={(e) =>
                        updateCharacter(char.characterId, (c) => ({
                          ...c,
                          voiceProfile: {
                            ...c.voiceProfile,
                            enVoiceName: e.target.value,
                          },
                        }))
                      }
                      className="touch-target w-full px-2 py-1.5 border rounded"
                      style={{ borderColor: 'var(--border-hairline)' }}
                    >
                      {prebuiltVoices.map((v) => (
                        <option key={v.voiceName} value={v.voiceName}>
                          {v.voiceName} ({v.timbreEn})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label
                      htmlFor={`unrevealed-${char.characterId}`}
                      className="block font-semibold mb-1"
                    >
                      공개 전 가명 (스포일러 방지)
                    </label>
                    <input
                      id={`unrevealed-${char.characterId}`}
                      type="text"
                      value={char.unrevealedLabelKo}
                      onChange={(e) =>
                        updateCharacter(char.characterId, (c) => ({
                          ...c,
                          unrevealedLabelKo: e.target.value,
                        }))
                      }
                      className="w-full px-2 py-1.5 border rounded"
                      style={{ borderColor: 'var(--border-hairline)' }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`reveal-panel-${char.characterId}`}
                      className="block font-semibold mb-1"
                    >
                      실명 공개 시점 컷
                    </label>
                    <select
                      id={`reveal-panel-${char.characterId}`}
                      value={char.revealedAtPanelId || ''}
                      onChange={(e) =>
                        updateCharacter(char.characterId, (c) => ({
                          ...c,
                          revealedAtPanelId: e.target.value || undefined,
                        }))
                      }
                      className="w-full px-2 py-1.5 border rounded"
                      style={{ borderColor: 'var(--border-hairline)' }}
                    >
                      <option value="">처음부터 실명 공개</option>
                      {revision.panels.map((p, idx) => (
                        <option key={p.panelId} value={p.panelId}>
                          {idx + 1}번째 컷 ({p.panelId})부터 실명 공개
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="text-xs">
                  <label
                    htmlFor={`style-ko-${char.characterId}`}
                    className="block font-semibold mb-1"
                  >
                    연기 디렉션 (Style Prompt)
                  </label>
                  <input
                    id={`style-ko-${char.characterId}`}
                    type="text"
                    value={char.voiceProfile.stylePromptKo}
                    onChange={(e) =>
                      updateCharacter(char.characterId, (c) => ({
                        ...c,
                        voiceProfile: {
                          ...c.voiceProfile,
                          stylePromptKo: e.target.value,
                        },
                      }))
                    }
                    className="w-full px-2 py-1.5 border rounded"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 섹션 2: 컷별 장면 해설, 전환 대기 시간(extraHoldMs), 효과음, 세그먼트 대사 편집 */}
        {activePanel && (
          <section
            aria-labelledby="cut-workbench-heading"
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
          >
            {/* 좌측 컷 선택 목록 */}
            <div
              className="lg:col-span-3 p-4 border rounded space-y-3 max-h-[680px] overflow-y-auto"
              style={{
                borderColor: 'var(--border-hairline)',
                backgroundColor: 'var(--bg-card)',
              }}
            >
              <h2 id="cut-workbench-heading" className="text-sm font-bold">
                컷 목록 ({revision.panels.length}컷)
              </h2>
              <div className="space-y-1.5">
                {revision.panels.map((p, idx) => (
                  <button
                    key={p.panelId}
                    type="button"
                    onClick={() => setSelectedPanelIndex(idx)}
                    className="touch-target w-full text-left px-3 py-2 rounded border text-xs cursor-pointer"
                    style={{
                      borderColor:
                        idx === selectedPanelIndex
                          ? 'var(--accent-vermilion)'
                          : 'var(--border-hairline)',
                      backgroundColor:
                        idx === selectedPanelIndex
                          ? 'var(--bg-subtle)'
                          : 'var(--bg-paper)',
                    }}
                  >
                    <div className="font-bold">
                      제 {idx + 1} 컷 ({p.panelId})
                    </div>
                    <div className="truncate mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                      {p.visualSummaryKo}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 우측 선택된 컷 편집 패널 */}
            <div
              className="lg:col-span-9 p-6 border rounded space-y-6"
              style={{
                borderColor: 'var(--border-hairline)',
                backgroundColor: 'var(--bg-card)',
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4" style={{ borderColor: 'var(--border-hairline)' }}>
                <div>
                  <h3 className="text-lg font-bold">
                    제 {selectedPanelIndex + 1} 컷 세부 연출 ({activePanel.panelId})
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    원고 Y좌표: {activePanel.globalYStart}px ~ {activePanel.globalYEnd}px
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="panel-hold-ms" className="font-semibold">
                    컷 종료 후 여운 대기 시간(ms):
                  </label>
                  <input
                    id="panel-hold-ms"
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    value={activePanel.extraHoldMs}
                    onChange={(e) =>
                      updatePanel(activePanel.panelId, (p) => ({
                        ...p,
                        extraHoldMs: Number(e.target.value),
                      }))
                    }
                    className="touch-target w-24 px-2.5 py-1.5 border rounded font-bold tabular-nums"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                </div>
              </div>

              {/* 장면 해설 편집 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="panel-summary-ko" className="block text-xs font-bold mb-1">
                    시각 장면 해설 (한국어)
                  </label>
                  <textarea
                    id="panel-summary-ko"
                    rows={3}
                    value={activePanel.visualSummaryKo}
                    onChange={(e) =>
                      updatePanel(activePanel.panelId, (p) => ({
                        ...p,
                        visualSummaryKo: e.target.value,
                      }))
                    }
                    className="w-full p-2.5 border rounded text-sm"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                </div>
                <div>
                  <label htmlFor="panel-summary-en" className="block text-xs font-bold mb-1">
                    Visual Scene Description (English)
                  </label>
                  <textarea
                    id="panel-summary-en"
                    rows={3}
                    value={activePanel.visualSummaryEn}
                    onChange={(e) =>
                      updatePanel(activePanel.panelId, (p) => ({
                        ...p,
                        visualSummaryEn: e.target.value,
                      }))
                    }
                    className="w-full p-2.5 border rounded text-sm"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                </div>
              </div>

              {/* 음향 효과 큐 편집 */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold">
                  컷 음향 효과 큐 ({panelCues.length}건)
                </h4>
                {panelCues.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    이 컷에는 별도의 음향 효과 큐가 없습니다.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {panelCues.map((cue) => (
                      <div
                        key={cue.cueId}
                        className="p-3 border rounded flex flex-wrap items-center justify-between gap-3 text-xs"
                        style={{
                          borderColor: 'var(--border-hairline)',
                          backgroundColor: 'var(--bg-paper)',
                        }}
                      >
                        <div>
                          <span className="font-bold">원문 의성어: {cue.rawSfxTextKo}</span>
                          <span className="ml-2" style={{ color: 'var(--ink-secondary)' }}>
                            ({cue.meaningKo})
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`${cue.rawSfxTextKo} 음향 에셋 선택`}
                            value={cue.soundAssetId || ''}
                            onChange={(e) =>
                              updateSoundCue(cue.cueId, (c) => ({
                                ...c,
                                soundAssetId: e.target.value || undefined,
                                fallbackMode: e.target.value ? 'sound_effect' : 'text_only',
                              }))
                            }
                            className="touch-target px-2.5 py-1 border rounded"
                            style={{ borderColor: 'var(--border-hairline)' }}
                          >
                            <option value="">음성 해설 폴백 (Text Only)</option>
                            {soundLibrary.map((s) => (
                              <option key={s.soundAssetId} value={s.soundAssetId}>
                                {s.titleKo} ({s.durationMs}ms)
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 세그먼트 대사 및 내레이션 편집 */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold">
                  세그먼트 대사 · 내레이션 트랙 ({panelSegments.length}건)
                </h4>
                <div className="space-y-3">
                  {panelSegments.map((seg) => (
                    <div
                      key={seg.segmentId}
                      className="p-4 border rounded space-y-3"
                      style={{
                        borderColor: 'var(--border-hairline)',
                        backgroundColor: 'var(--bg-paper)',
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold uppercase px-2 py-0.5 rounded border">
                            {seg.kind}
                          </span>
                          <select
                            aria-label={`${seg.segmentId} 화자 선택`}
                            value={seg.speakerCharacterId || ''}
                            onChange={(e) =>
                              updateSegment(seg.segmentId, (s) => ({
                                ...s,
                                speakerCharacterId: e.target.value,
                              }))
                            }
                            className="touch-target px-2.5 py-1 border rounded font-semibold"
                            style={{ borderColor: 'var(--border-hairline)' }}
                          >
                            {revision.characters.map((c) => (
                              <option key={c.characterId} value={c.characterId}>
                                {c.canonicalNameKo} ({c.voiceProfile.koVoiceName})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          <label htmlFor={`pause-${seg.segmentId}`}>대사 후 호흡(ms):</label>
                          <input
                            id={`pause-${seg.segmentId}`}
                            type="number"
                            min={0}
                            max={3000}
                            step={20}
                            value={seg.pauseAfterMs}
                            onChange={(e) =>
                              updateSegment(seg.segmentId, (s) => ({
                                ...s,
                                pauseAfterMs: Number(e.target.value),
                              }))
                            }
                            className="w-20 px-2 py-1 border rounded tabular-nums"
                            style={{ borderColor: 'var(--border-hairline)' }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor={`seg-ko-${seg.segmentId}`}
                            className="block text-xs font-semibold mb-1"
                          >
                            한국어 낭독 대본
                          </label>
                          <textarea
                            id={`seg-ko-${seg.segmentId}`}
                            rows={2}
                            value={seg.textKo}
                            onChange={(e) =>
                              updateSegment(seg.segmentId, (s) => ({
                                ...s,
                                textKo: e.target.value,
                              }))
                            }
                            className="w-full p-2 border rounded text-sm"
                            style={{ borderColor: 'var(--border-hairline)' }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`seg-en-${seg.segmentId}`}
                            className="block text-xs font-semibold mb-1"
                          >
                            English Script
                          </label>
                          <textarea
                            id={`seg-en-${seg.segmentId}`}
                            rows={2}
                            value={seg.textEn}
                            onChange={(e) =>
                              updateSegment(seg.segmentId, (s) => ({
                                ...s,
                                textEn: e.target.value,
                              }))
                            }
                            className="w-full p-2 border rounded text-sm"
                            style={{ borderColor: 'var(--border-hairline)' }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 섹션 3: 품질 검증 리포트 및 작업 큐 모니터링 */}
        <section
          aria-labelledby="validation-section-heading"
          className="p-6 border rounded space-y-4"
          style={{
            borderColor: 'var(--border-hairline)',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="validation-section-heading" className="text-lg font-bold">
                출판 전 10단계 자동 검증 리포트 및 작업 큐 ({tasks.length}건)
              </h2>
              <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                누락된 컷·세그먼트, 오디오 헤더 무결성, 화자 매핑, 사운드 에셋 체크섬을 자동 검증하고 복구 가능한 오류는 1회 자동 보정합니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRunJob('validate')}
                className="touch-target px-3.5 py-2 border rounded text-xs font-semibold cursor-pointer"
                style={{ borderColor: 'var(--border-hairline)' }}
              >
                검증 재실행
              </button>
              <button
                type="button"
                onClick={() => handleRunJob('reconcile_tasks')}
                className="touch-target px-3.5 py-2 border rounded text-xs font-semibold cursor-pointer"
                style={{ borderColor: 'var(--border-hairline)' }}
              >
                만료된 작업 리스 복구
              </button>
            </div>
          </div>

          {revision.validationReport && (
            <div
              className="p-4 border rounded text-xs space-y-2"
              style={{
                borderColor: revision.validationReport.valid
                  ? 'var(--accent-pine)'
                  : 'var(--accent-vermilion)',
                backgroundColor: 'var(--bg-paper)',
              }}
            >
              <div className="font-bold">
                검증 결과: {revision.validationReport.valid ? '통과 (PASS)' : '오류 발견 (FAIL)'}{' '}
                {revision.validationReport.autoCorrectionAttempted &&
                  `· 1회 자동 보정 실행됨 (${
                    revision.validationReport.autoCorrectionSucceeded ? '보정 후 통과' : '수동 확인 필요'
                  })`}
              </div>
              {revision.validationReport.autoCorrectionNotes.length > 0 && (
                <ul className="list-disc pl-5 space-y-1">
                  {revision.validationReport.autoCorrectionNotes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              )}
              {revision.validationReport.issues.length > 0 && (
                <ul className="list-disc pl-5 space-y-1">
                  {revision.validationReport.issues.map((iss, idx) => (
                    <li key={idx}>
                      [{iss.severity.toUpperCase()}] {iss.code}: {iss.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
