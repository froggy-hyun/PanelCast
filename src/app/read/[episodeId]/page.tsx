'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { LocaleCode, ManifestPanelEntry } from '@/lib/types';

interface EpisodeHeaderInfo {
  episodeId: string;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  authorName: string;
  publishedRevisionId?: string;
}

export default function AccessibleReaderPage() {
  const params = useParams<{ episodeId: string }>();
  const searchParams = useSearchParams();
  const episodeId = params.episodeId;

  const initialLang: LocaleCode = searchParams.get('lang') === 'en' ? 'en' : 'ko';
  const [locale, setLocale] = useState<LocaleCode>(initialLang);
  const [highContrast, setHighContrast] = useState(false);

  const [episodeInfo, setEpisodeInfo] = useState<EpisodeHeaderInfo | null>(null);
  const [pinnedRevisionId, setPinnedRevisionId] = useState<string | null>(
    searchParams.get('revisionId'),
  );
  const [panels, setPanels] = useState<ManifestPanelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [playbackSessionId, setPlaybackSessionId] = useState(1);
  const [activeAudioCount, setActiveAudioCount] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const [reportText, setReportText] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const playbackSessionRef = useRef(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveAudioWaitRef = useRef<(() => void) | null>(null);
  const panelsRef = useRef<ManifestPanelEntry[]>([]);
  const playbackRateRef = useRef(1.0);

  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (highContrast) {
      document.documentElement.setAttribute('data-contrast', 'high');
    } else {
      document.documentElement.removeAttribute('data-contrast');
    }
  }, [highContrast]);

  // 현재 재생 중인 오디오 및 타이머를 즉시 중단하고 새 세션 ID 발급 (T11, T12)
  const cancelCurrentPlaybackSession = useCallback(() => {
    const nextSessionId = playbackSessionRef.current + 1;
    playbackSessionRef.current = nextSessionId;
    setPlaybackSessionId(nextSessionId);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    if (resolveAudioWaitRef.current) {
      const done = resolveAudioWaitRef.current;
      resolveAudioWaitRef.current = null;
      done();
    }
    setActiveAudioCount(0);
    return nextSessionId;
  }, []);

  // 매니페스트 페이지네이션 전체 로드 (활성 세션의 revisionId 고정 T08, T18)
  const loadManifestForLocale = useCallback(
    async (targetLocale: LocaleCode, targetRevId: string | null) => {
      setLoading(true);
      setLoadError('');
      try {
        let cursor: string | undefined = undefined;
        let accumulated: ManifestPanelEntry[] = [];
        let resolvedRevId = targetRevId;
        let epMeta: EpisodeHeaderInfo | null = null;

        while (true) {
          const qs = new URLSearchParams({
            locale: targetLocale,
            limit: '50',
          });
          if (resolvedRevId) {
            qs.set('revisionId', resolvedRevId);
          }
          if (cursor) {
            qs.set('cursor', cursor);
          }

          const res = await fetch(`/api/episodes/${episodeId}/manifest?${qs.toString()}`);
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(err.error || 'Failed to load playback manifest');
          }

          const data = (await res.json()) as {
            episode: EpisodeHeaderInfo;
            revisionId: string;
            panels: ManifestPanelEntry[];
            nextCursor?: string;
            hasMore: boolean;
          };

          epMeta = data.episode;
          resolvedRevId = data.revisionId;
          accumulated = [...accumulated, ...data.panels];

          if (!data.hasMore || !data.nextCursor) {
            break;
          }
          cursor = data.nextCursor;
        }

        if (epMeta) {
          setEpisodeInfo(epMeta);
        }
        if (resolvedRevId && !pinnedRevisionId) {
          setPinnedRevisionId(resolvedRevId);
        }
        setPanels(accumulated);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [episodeId, pinnedRevisionId],
  );

  useEffect(() => {
    void loadManifestForLocale(locale, pinnedRevisionId);
    return () => {
      cancelCurrentPlaybackSession();
    };
  }, [locale, pinnedRevisionId, loadManifestForLocale, cancelCurrentPlaybackSession]);

  const waitMsWithSession = useCallback((ms: number, sessionId: number): Promise<boolean> => {
    return new Promise((resolve) => {
      if (sessionId !== playbackSessionRef.current) {
        resolve(false);
        return;
      }
      if (ms <= 0) {
        resolve(true);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        resolve(sessionId === playbackSessionRef.current);
      }, ms);
    });
  }, []);

  const playSingleAudioUrl = useCallback(
    (url: string, sessionId: number): Promise<boolean> => {
      return new Promise((resolve) => {
        if (sessionId !== playbackSessionRef.current) {
          resolve(false);
          return;
        }
        let audio = audioRef.current;
        if (!audio) {
          audio = new Audio();
          audioRef.current = audio;
        }

        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolveAudioWaitRef.current = null;
          setActiveAudioCount(0);
          resolve(ok && sessionId === playbackSessionRef.current);
        };

        resolveAudioWaitRef.current = () => finish(false);
        audio.onended = () => finish(true);
        audio.onerror = () => finish(true);
        audio.src = url;
        audio.playbackRate = playbackRateRef.current;
        setActiveAudioCount(1);

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            finish(true);
          });
        }
      });
    },
    [],
  );

  // 지정한 컷과 세그먼트부터 순차 재생 (모든 세그먼트 ended 및 extraHoldMs 경과 후에만 다음 컷 전환 T10)
  const runSequentialPlayback = useCallback(
    async (startPanelIdx: number, startSegIdx: number, sessionId: number) => {
      const list = panelsRef.current;
      if (list.length === 0 || sessionId !== playbackSessionRef.current) {
        setIsPlaying(false);
        return;
      }

      for (let pIdx = startPanelIdx; pIdx < list.length; pIdx++) {
        if (sessionId !== playbackSessionRef.current) return;
        const panel = list[pIdx];
        setCurrentPanelIndex(pIdx);
        const firstSegIdx = pIdx === startPanelIdx ? startSegIdx : 0;
        setCurrentSegmentIndex(firstSegIdx);

        setLiveAnnouncement(
          locale === 'ko'
            ? `${pIdx + 1}번째 컷 재생 시작. ${panel.visualSummary}`
            : `Playing cut ${pIdx + 1}. ${panel.visualSummary}`,
        );

        // 1. 컷 시작 시 음향 효과 큐 재생 (첫 세그먼트부터 시작할 때만)
        if (firstSegIdx === 0) {
          for (const cue of panel.soundCues) {
            if (sessionId !== playbackSessionRef.current) return;
            if (cue.fallbackMode === 'sound_effect' && cue.audioUrl) {
              const ok = await playSingleAudioUrl(cue.audioUrl, sessionId);
              if (!ok) return;
            }
          }
        }

        // 2. 컷 내 모든 세그먼트 오디오를 순서대로 끝까지 재생
        for (let sIdx = firstSegIdx; sIdx < panel.segments.length; sIdx++) {
          if (sessionId !== playbackSessionRef.current) return;
          setCurrentSegmentIndex(sIdx);
          const seg = panel.segments[sIdx];

          const ok = await playSingleAudioUrl(seg.audioUrl, sessionId);
          if (!ok) return;

          if (seg.pauseAfterMs > 0) {
            const waited = await waitMsWithSession(seg.pauseAfterMs, sessionId);
            if (!waited) return;
          }
        }

        // 3. 모든 세그먼트 종료 후 컷 전환 대기 시간(extraHoldMs) 적용 후 다음 컷으로 이동
        if (panel.extraHoldMs > 0) {
          const held = await waitMsWithSession(panel.extraHoldMs, sessionId);
          if (!held) return;
        }
      }

      if (sessionId === playbackSessionRef.current) {
        setIsPlaying(false);
        setLiveAnnouncement(
          locale === 'ko'
            ? '에피소드 마지막 컷까지 재생을 마쳤습니다.'
            : 'Finished playing the final cut of the episode.',
        );
      }
    },
    [locale, playSingleAudioUrl, waitMsWithSession],
  );

  const handleTogglePlayPause = useCallback(() => {
    if (isPlaying) {
      cancelCurrentPlaybackSession();
      setIsPlaying(false);
      setLiveAnnouncement(locale === 'ko' ? '재생 일시정지됨' : 'Playback paused');
    } else {
      const nextSession = cancelCurrentPlaybackSession();
      setIsPlaying(true);
      void runSequentialPlayback(currentPanelIndex, currentSegmentIndex, nextSession);
    }
  }, [
    isPlaying,
    cancelCurrentPlaybackSession,
    locale,
    runSequentialPlayback,
    currentPanelIndex,
    currentSegmentIndex,
  ]);

  const handleJumpToPanel = useCallback(
    (targetIdx: number, autoPlayOverride?: boolean) => {
      const list = panelsRef.current;
      if (list.length === 0) return;
      const bounded = Math.min(Math.max(targetIdx, 0), list.length - 1);
      const shouldPlay = autoPlayOverride ?? isPlaying;
      const nextSession = cancelCurrentPlaybackSession();

      setCurrentPanelIndex(bounded);
      setCurrentSegmentIndex(0);
      const targetPanel = list[bounded];
      setLiveAnnouncement(
        locale === 'ko'
          ? `총 ${list.length}컷 중 ${bounded + 1}번째 컷으로 이동. ${targetPanel?.visualSummary ?? ''}`
          : `Moved to cut ${bounded + 1} of ${list.length}. ${targetPanel?.visualSummary ?? ''}`,
      );

      if (shouldPlay) {
        setIsPlaying(true);
        void runSequentialPlayback(bounded, 0, nextSession);
      } else {
        setIsPlaying(false);
      }
    },
    [isPlaying, cancelCurrentPlaybackSession, locale, runSequentialPlayback],
  );

  const handleReplayCurrentPanel = useCallback(() => {
    handleJumpToPanel(currentPanelIndex, true);
  }, [handleJumpToPanel, currentPanelIndex]);

  const handleSwitchLocale = useCallback(
    (nextLocale: LocaleCode) => {
      if (nextLocale === locale) return;
      cancelCurrentPlaybackSession();
      setIsPlaying(false);
      setCurrentSegmentIndex(0);
      setLocale(nextLocale);
      setLiveAnnouncement(
        nextLocale === 'ko'
          ? '언어가 한국어로 전환되었습니다.'
          : 'Language switched to English.',
      );
    },
    [locale, cancelCurrentPlaybackSession],
  );

  // 키보드 단축키 지원 (입력 필드 포커스 시 단축키 비활성화 T15)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleJumpToPanel(currentPanelIndex + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        handleJumpToPanel(currentPanelIndex - 1);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleReplayCurrentPanel();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleSwitchLocale(locale === 'ko' ? 'en' : 'ko');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleTogglePlayPause,
    handleJumpToPanel,
    handleReplayCurrentPanel,
    handleSwitchLocale,
    currentPanelIndex,
    locale,
  ]);

  async function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reportText.trim()) return;
    const activePanel = panels[currentPanelIndex];
    const activeSeg = activePanel?.segments[currentSegmentIndex];
    await fetch(`/api/episodes/${episodeId}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        panelId: activePanel?.panelId,
        segmentId: activeSeg?.segmentId,
        message: reportText,
      }),
    });
    setReportText('');
    setReportSubmitted(true);
    setLiveAnnouncement(
      locale === 'ko'
        ? '접근성 의견이 정상적으로 접수되었습니다.'
        : 'Accessibility report submitted.',
    );
  }

  const activePanel = panels[currentPanelIndex];

  return (
    <div
      lang={locale}
      data-testid="reader-root"
      data-playback-session-id={playbackSessionId}
      data-active-audio-count={activeAudioCount}
      data-pinned-revision-id={pinnedRevisionId || ''}
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--bg-paper)', color: 'var(--ink-primary)' }}
    >
      {/* 스크린리더 실시간 알림 영역 */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-announcer"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      {/* 상단 리더 헤더 */}
      <header
        className="border-b sticky top-0 z-20"
        style={{
          borderColor: 'var(--border-hairline)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              href="/"
              className="inline-flex items-center gap-2 no-underline py-1"
              aria-label="PanelCast 서재 홈으로 이동"
            >
              <img
                src="/logo.png"
                alt="PanelCast"
                className="brand-logo"
                width={158}
                height={25}
              />
            </Link>
            <Link
              href="/"
              className="touch-target inline-flex items-center px-3 py-1.5 border rounded-md text-xs sm:text-sm font-semibold no-underline"
              style={{
                borderColor: 'var(--border-hairline)',
                backgroundColor: 'var(--bg-paper)',
                color: 'var(--ink-primary)',
              }}
            >
              {locale === 'ko' ? '← 서재로 돌아가기' : '← Back to Library'}
            </Link>
            <div className="border-l pl-3.5" style={{ borderColor: 'var(--border-hairline)' }}>
              <h1 className="font-editorial text-lg sm:text-xl font-bold leading-tight">
                {episodeInfo
                  ? locale === 'ko'
                    ? episodeInfo.titleKo
                    : episodeInfo.titleEn
                  : locale === 'ko'
                    ? '웹툰 오디오 리더'
                    : 'Webtoon Audio Reader'}
              </h1>
              {episodeInfo && (
                <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                  {episodeInfo.authorName} ·{' '}
                  {locale === 'ko'
                    ? `총 ${panels.length}컷 중 ${panels.length > 0 ? currentPanelIndex + 1 : 0}번째 컷`
                    : `Cut ${panels.length > 0 ? currentPanelIndex + 1 : 0} of ${panels.length}`}
                </p>
              )}
            </div>
          </div>

          <nav
            aria-label={locale === 'ko' ? '언어 및 화면 대비 제어' : 'Language and contrast controls'}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              data-testid="locale-toggle-btn"
              onClick={() => handleSwitchLocale(locale === 'ko' ? 'en' : 'ko')}
              className="touch-target px-3.5 py-2 border rounded-md text-xs sm:text-sm font-semibold cursor-pointer"
              style={{
                borderColor: 'var(--border-strong)',
                backgroundColor: 'var(--bg-paper)',
                color: 'var(--ink-primary)',
              }}
            >
              {locale === 'ko' ? 'English Audio (영어 전환)' : '한국어 오디오 (Switch to KO)'}
            </button>

            <button
              type="button"
              data-testid="high-contrast-toggle-btn"
              onClick={() => setHighContrast(!highContrast)}
              aria-pressed={highContrast}
              className="touch-target px-3.5 py-2 border rounded-md text-xs sm:text-sm font-semibold cursor-pointer"
              style={{
                borderColor: highContrast ? 'var(--border-strong)' : 'var(--border-hairline)',
                backgroundColor: highContrast ? 'var(--ink-primary)' : 'var(--bg-paper)',
                color: highContrast ? 'var(--bg-paper)' : 'var(--ink-primary)',
              }}
            >
              {locale === 'ko'
                ? highContrast
                  ? '고대비 웹툰 · UI 켜짐'
                  : '고대비'
                : highContrast
                  ? 'High Contrast: ON'
                  : 'High Contrast'}
            </button>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div
            className="editorial-card p-10 rounded-xl text-center"
          >
            {locale === 'ko'
              ? '배리어프리 재생 대본과 음성 에셋을 불러오는 중입니다...'
              : 'Loading barrier-free playback manifest and audio tracks...'}
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="editorial-card p-8 rounded-xl space-y-3"
            style={{ borderColor: 'var(--accent-vermilion)' }}
          >
            <h2 className="text-lg font-bold">
              {locale === 'ko' ? '에피소드를 불러올 수 없습니다' : 'Unable to load episode'}
            </h2>
            <p className="text-sm">{loadError}</p>
          </div>
        ) : !activePanel ? (
          <div className="editorial-card p-8 rounded-xl">
            {locale === 'ko' ? '표시할 컷이 없습니다.' : 'No cuts available.'}
          </div>
        ) : (
          <>
            {/* 핵심 재생 컨트롤 바 */}
            <section
              aria-label={locale === 'ko' ? '오디오 재생 및 컷 이동 제어판' : 'Audio playback and cut navigation controls'}
              className="editorial-card p-4 sm:p-5 rounded-xl flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="prev-panel-btn"
                  disabled={currentPanelIndex <= 0}
                  onClick={() => handleJumpToPanel(currentPanelIndex - 1)}
                  className="touch-target px-4 py-2.5 border rounded-lg font-semibold text-sm cursor-pointer disabled:opacity-40"
                  style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-paper)' }}
                >
                  {locale === 'ko' ? '이전 컷 (←/K)' : 'Prev Cut (←/K)'}
                </button>

                <button
                  type="button"
                  data-testid="play-pause-btn"
                  onClick={handleTogglePlayPause}
                  className="touch-target px-6 py-2.5 rounded-lg font-bold text-sm cursor-pointer"
                  style={{
                    backgroundColor: 'var(--accent-vermilion)',
                    color: '#ffffff',
                  }}
                >
                  {isPlaying
                    ? locale === 'ko'
                      ? '일시정지 (Space)'
                      : 'Pause (Space)'
                    : locale === 'ko'
                      ? '연속 재생 시작 (Space)'
                      : 'Play Cut Sequence (Space)'}
                </button>

                <button
                  type="button"
                  data-testid="next-panel-btn"
                  disabled={currentPanelIndex >= panels.length - 1}
                  onClick={() => handleJumpToPanel(currentPanelIndex + 1)}
                  className="touch-target px-4 py-2.5 border rounded-lg font-semibold text-sm cursor-pointer disabled:opacity-40"
                  style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-paper)' }}
                >
                  {locale === 'ko' ? '다음 컷 (→/J)' : 'Next Cut (→/J)'}
                </button>

                <button
                  type="button"
                  data-testid="replay-panel-btn"
                  onClick={handleReplayCurrentPanel}
                  className="touch-target px-3.5 py-2.5 border rounded-lg text-sm font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-paper)' }}
                >
                  {locale === 'ko' ? '현재 컷 다시 듣기 (R)' : 'Replay Cut (R)'}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <label htmlFor="playback-rate-select" className="text-xs font-semibold">
                  {locale === 'ko' ? '재생 속도' : 'Speed'}
                </label>
                <select
                  id="playback-rate-select"
                  value={String(playbackRate)}
                  onChange={(e) => setPlaybackRate(Number(e.target.value))}
                  className="touch-target px-3 py-2 border rounded-lg text-sm font-semibold tabular-nums"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-paper)',
                    color: 'var(--ink-primary)',
                  }}
                >
                  <option value="0.85">0.85x</option>
                  <option value="1">1.0x</option>
                  <option value="1.25">1.25x</option>
                  <option value="1.5">1.5x</option>
                </select>
              </div>
            </section>

            {/* 현재 활성 컷 상세 및 원고 뷰 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* 좌측: 시각 원고 컷 하이라이트 뷰 (고대비 전환 시 고대비 원고 이미지로 교체) */}
              <section
                aria-label={locale === 'ko' ? '현재 컷 원고 이미지' : 'Current cut manuscript image'}
                className="lg:col-span-5 editorial-card rounded-xl overflow-hidden"
              >
                <div
                  className="px-4 py-3 border-b flex items-center justify-between text-xs font-semibold"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <span data-testid="active-panel-indicator" className="tabular-nums font-bold">
                    {locale === 'ko'
                      ? `제 ${currentPanelIndex + 1} 컷 / 전체 ${panels.length} 컷`
                      : `Cut ${currentPanelIndex + 1} of ${panels.length}`}
                  </span>
                  <div className="flex items-center gap-2">
                    {highContrast && (
                      <span
                        data-testid="high-contrast-artwork-badge"
                        className="px-2 py-0.5 rounded text-[11px] font-bold"
                        style={{
                          backgroundColor: 'var(--ink-primary)',
                          color: 'var(--bg-paper)',
                        }}
                      >
                        {locale === 'ko' ? '고대비 원고' : 'High-Contrast Art'}
                      </span>
                    )}
                    <span>{activePanel.emotionalTone}</span>
                  </div>
                </div>

                <div
                  className="p-3 flex justify-center"
                  style={{ backgroundColor: highContrast ? '#000000' : '#181816' }}
                >
                  <img
                    data-testid="active-panel-image"
                    data-contrast-mode={highContrast ? 'high' : 'normal'}
                    src={
                      highContrast
                        ? activePanel.highContrastImageUrl ||
                          `${activePanel.imageUrl}?contrast=high`
                        : activePanel.imageUrl
                    }
                    alt={activePanel.visualSummary}
                    className="max-h-[560px] w-auto object-contain rounded border"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  />
                </div>
              </section>

              {/* 우측: 장면 해설, 음향 효과, 등장인물 대사 트랙 */}
              <section
                aria-labelledby="current-cut-script-heading"
                className="lg:col-span-7 space-y-5"
              >
                <div
                  className="p-6 border rounded space-y-4"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-card)',
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id="current-cut-script-heading" className="text-xl font-bold">
                      {locale === 'ko'
                        ? `${currentPanelIndex + 1}번째 컷 장면 해설 및 대사`
                        : `Cut ${currentPanelIndex + 1} Scene Narration & Dialogue`}
                    </h2>
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--accent-pine)',
                      }}
                    >
                      {activePanel.emotionalTone}
                    </span>
                  </div>

                  {/* 시각 장면 요약 블록 */}
                  <div
                    className="p-4 rounded border-l-4"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderLeftColor: 'var(--accent-vermilion)',
                    }}
                  >
                    <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--ink-muted)' }}>
                      {locale === 'ko' ? '시각 장면 해설 (Scene Description)' : 'Visual Scene Description'}
                    </div>
                    <p data-testid="panel-visual-summary" className="text-base font-medium leading-relaxed">
                      {activePanel.visualSummary}
                    </p>
                  </div>

                  {/* 음향 효과 배지 */}
                  {activePanel.soundCues.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                        {locale === 'ko' ? '장면 음향 효과 (Sound Cues)' : 'Scene Sound Cues'}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {activePanel.soundCues.map((cue) => (
                          <span
                            key={cue.cueId}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border"
                            style={{
                              borderColor: 'var(--border-hairline)',
                              backgroundColor: 'var(--bg-paper)',
                            }}
                          >
                            <span>[SFX] {cue.meaning}</span>
                            <span style={{ color: 'var(--ink-muted)' }}>
                              ({cue.fallbackMode === 'sound_effect'
                                ? locale === 'ko'
                                  ? '음향 재생'
                                  : 'Audio SFX'
                                : locale === 'ko'
                                  ? '음성 해설 폴백'
                                  : 'Voice Fallback'})
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 세그먼트 대사/내레이션 목록 */}
                  <div className="space-y-3 pt-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                      {locale === 'ko' ? '순차 오디오 세그먼트 트랙' : 'Sequential Audio Segment Tracks'}
                    </h3>
                    <ol className="space-y-2.5 list-none p-0 m-0">
                      {activePanel.segments.map((seg, sIdx) => {
                        const isActiveSeg = sIdx === currentSegmentIndex;
                        return (
                          <li
                            key={seg.segmentId}
                            data-testid={`segment-item-${sIdx}`}
                            data-active={isActiveSeg ? 'true' : 'false'}
                            className="p-4 border rounded transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            style={{
                              borderColor: isActiveSeg
                                ? 'var(--accent-vermilion)'
                                : 'var(--border-hairline)',
                              backgroundColor: isActiveSeg
                                ? 'var(--bg-subtle)'
                                : 'var(--bg-paper)',
                            }}
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  data-testid={`segment-speaker-${sIdx}`}
                                  className="text-xs font-bold px-2 py-0.5 rounded"
                                  style={{
                                    backgroundColor: 'var(--ink-primary)',
                                    color: 'var(--bg-paper)',
                                  }}
                                >
                                  {seg.speakerDisplayName}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                                  {seg.deliveryStyle} · {seg.voiceName}
                                </span>
                              </div>
                              <p
                                data-testid={`segment-text-${sIdx}`}
                                className="text-base font-medium leading-relaxed"
                              >
                                {seg.text}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                const nextSession = cancelCurrentPlaybackSession();
                                setCurrentSegmentIndex(sIdx);
                                setIsPlaying(true);
                                void runSequentialPlayback(
                                  currentPanelIndex,
                                  sIdx,
                                  nextSession,
                                );
                              }}
                              aria-label={
                                locale === 'ko'
                                  ? `이 대사부터 듣기 (${seg.speakerDisplayName})`
                                  : `Play Here (${seg.speakerDisplayName})`
                              }
                              className="touch-target shrink-0 px-3.5 py-2 border rounded text-xs font-semibold cursor-pointer"
                              style={{
                                borderColor: 'var(--border-strong)',
                                backgroundColor: 'var(--bg-card)',
                              }}
                            >
                              {locale === 'ko' ? '이 대사부터 듣기' : 'Play Here'}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>

                {/* 전체 컷 빠른 이동 목차 */}
                <div
                  className="p-5 border rounded space-y-3"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-card)',
                  }}
                >
                  <h3 className="text-sm font-bold">
                    {locale === 'ko' ? '전체 컷 빠른 이동 목차' : 'Quick Cut Index'}
                  </h3>
                  <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-1">
                    {panels.map((p, idx) => (
                      <button
                        key={p.panelId}
                        type="button"
                        data-testid={`jump-panel-${idx}`}
                        onClick={() => handleJumpToPanel(idx)}
                        aria-current={idx === currentPanelIndex ? 'step' : undefined}
                        aria-label={
                          locale === 'ko'
                            ? `${idx + 1} 번째 컷으로 이동`
                            : `Jump to cut ${idx + 1}`
                        }
                        className="touch-target px-3 py-1.5 rounded text-xs font-bold tabular-nums border cursor-pointer"
                        style={{
                          borderColor:
                            idx === currentPanelIndex
                              ? 'var(--accent-vermilion)'
                              : 'var(--border-hairline)',
                          backgroundColor:
                            idx === currentPanelIndex
                              ? 'var(--accent-vermilion)'
                              : 'var(--bg-paper)',
                          color:
                            idx === currentPanelIndex ? '#ffffff' : 'var(--ink-primary)',
                        }}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 독자 접근성 오류/발음 제보 양식 (입력 중 단축키 간섭 방지 T15 검증용) */}
                <form
                  onSubmit={handleReportSubmit}
                  className="p-5 border rounded space-y-3"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-card)',
                  }}
                >
                  <label htmlFor="reader-issue-input" className="block text-sm font-bold">
                    {locale === 'ko'
                      ? '장면 해설 · 발음 개선 제보'
                      : 'Report Narration or Pronunciation Feedback'}
                  </label>
                  <textarea
                    id="reader-issue-input"
                    data-testid="reader-issue-input"
                    rows={2}
                    value={reportText}
                    onChange={(e) => {
                      setReportText(e.target.value);
                      setReportSubmitted(false);
                    }}
                    placeholder={
                      locale === 'ko'
                        ? '현재 컷의 장면 묘사나 성우 발음에서 어색한 부분이 있다면 남겨주세요 (입력 중에는 스페이스바 등 재생 단축키가 동작하지 않습니다).'
                        : 'Share any feedback on the current cut description or pronunciation (hotkeys are paused while typing).'
                    }
                    className="w-full p-3 border rounded text-sm"
                    style={{
                      borderColor: 'var(--border-hairline)',
                      backgroundColor: 'var(--bg-paper)',
                      color: 'var(--ink-primary)',
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                      {reportSubmitted
                        ? locale === 'ko'
                          ? '제보가 저장되었습니다. 감사합니다.'
                          : 'Feedback saved. Thank you.'
                        : ''}
                    </span>
                    <button
                      type="submit"
                      className="touch-target px-4 py-2 border rounded text-xs font-semibold cursor-pointer"
                      style={{
                        borderColor: 'var(--border-strong)',
                        backgroundColor: 'var(--bg-paper)',
                      }}
                    >
                      {locale === 'ko' ? '의견 보내기' : 'Submit Feedback'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
