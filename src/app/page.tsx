'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Episode, LocaleCode, PublishMode } from '@/lib/types';

type HomeMenuTab = 'library' | 'desk';

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HomeMenuTab>('library');
  const [locale, setLocale] = useState<LocaleCode>('ko');
  const [highContrast, setHighContrast] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [studioEpisodes, setStudioEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);

  const [titleKo, setTitleKo] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [summaryKo, setSummaryKo] = useState('');
  const [summaryEn, setSummaryEn] = useState('');
  const [publishMode, setPublishMode] = useState<PublishMode>('auto_publish');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [submitError, setSubmitError] = useState('');

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

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

  async function loadCatalog() {
    setLoading(true);
    try {
      const [pubRes, allRes] = await Promise.all([
        fetch('/api/episodes'),
        fetch('/api/episodes?includeDrafts=true'),
      ]);
      if (pubRes.ok) {
        const data = (await pubRes.json()) as { episodes: Episode[] };
        setEpisodes(data.episodes ?? []);
      }
      if (allRes.ok) {
        const allData = (await allRes.json()) as { episodes: Episode[] };
        setStudioEpisodes(allData.episodes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  async function handleDeleteEpisode(e: React.FormEvent, episodeId: string) {
    e.preventDefault();
    setDeleteError('');
    setDeleting(true);
    try {
      const res = await fetch(`/api/studio/episodes/${episodeId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(
          err.error ||
            (locale === 'ko'
              ? '삭제 비밀번호가 올바르지 않습니다.'
              : 'Invalid delete password.'),
        );
        return;
      }
      setDeleteTargetId(null);
      setDeletePassword('');
      await loadCatalog();
    } finally {
      setDeleting(false);
    }
  }

  async function handleManuscriptUpload(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    if (selectedFiles.length === 0) {
      setSubmitError(
        locale === 'ko'
          ? '웹툰 원고 이미지 파일(JPG, PNG, WEBP)을 1개 이상 선택해 주세요.'
          : 'Please select at least one manuscript image file.',
      );
      return;
    }

    setSubmitting(true);
    setSubmitStatus(
      locale === 'ko'
        ? '1/3 원고 이미지 업로드 및 스트립 타일링 중...'
        : '1/3 Uploading manuscript strips and building overlap tiles...',
    );

    try {
      const formData = new FormData();
      formData.set('titleKo', titleKo || '새 에피소드');
      formData.set('titleEn', titleEn || titleKo || 'New Episode');
      formData.set('authorName', authorName || 'PanelCast Creator');
      formData.set('summaryKo', summaryKo);
      formData.set('summaryEn', summaryEn || summaryKo);
      formData.set('publishMode', publishMode);
      formData.set('runImmediately', 'false');

      for (const file of selectedFiles) {
        formData.append('files', file);
      }

      const createRes = await fetch('/api/studio/episodes', {
        method: 'POST',
        body: formData,
      });

      if (!createRes.ok) {
        const errData = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || 'Failed to upload episode manuscript');
      }

      const created = (await createRes.json()) as {
        episode: Episode;
        revision: { revisionId: string };
      };

      if (publishMode === 'auto_publish') {
        setSubmitStatus(
          locale === 'ko'
            ? '2/3 Gemini 멀티모달 컷 분석, 다중 성우 음성 합성 및 검증 중...'
            : '2/3 Running Gemini multimodal analysis, multi-voice TTS, and validation...',
        );

        const jobRes = await fetch(
          `/api/studio/episodes/${created.episode.episodeId}/jobs`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              revisionId: created.revision.revisionId,
              action: 'auto_publish',
            }),
          },
        );

        if (!jobRes.ok) {
          const errData = (await jobRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || 'Auto publish pipeline failed');
        }

        setSubmitStatus(
          locale === 'ko'
            ? '3/3 바로 등록 완료! 감상 페이지로 이동합니다.'
            : '3/3 Auto-publish complete! Redirecting to reader...',
        );
        await loadCatalog();
        router.push(`/read/${created.episode.episodeId}`);
      } else {
        setSubmitStatus(
          locale === 'ko'
            ? '2/3 AI 초기 컷/대사 분석 후 접근성 커스텀 스튜디오로 이동합니다...'
            : '2/3 Running initial cut analysis before opening Customization Studio...',
        );

        await fetch(`/api/studio/episodes/${created.episode.episodeId}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            revisionId: created.revision.revisionId,
            action: 'analyze',
          }),
        });

        router.push(`/studio/${created.episode.episodeId}`);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      lang={locale}
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--bg-paper)', color: 'var(--ink-primary)' }}
    >
      {/* 상단 브랜드 헤더 및 2-탭 내비게이션 바 */}
      <header
        className="border-b sticky top-0 z-30"
        style={{
          borderColor: 'var(--border-hairline)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="py-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <Link
                href="/"
                onClick={() => setActiveTab('library')}
                className="inline-flex items-center gap-2.5 no-underline py-1"
                aria-label="PanelCast 홈으로 이동"
              >
                <img
                  src="/logo.png"
                  alt="PanelCast"
                  className="brand-logo"
                  width={183}
                  height={29}
                />
              </Link>
              <span
                className="hidden sm:inline-block text-xs font-semibold tracking-tight px-2.5 py-1 rounded-full border"
                style={{
                  borderColor: 'var(--border-hairline)',
                  backgroundColor: 'var(--bg-paper)',
                  color: 'var(--ink-secondary)',
                }}
              >
                {locale === 'ko' ? '배리어프리 웹툰 오디오북 서재' : 'Barrier-Free Webtoon Audio Edition'}
              </span>
            </div>

            <nav
              aria-label={locale === 'ko' ? '전역 접근성 및 언어 설정' : 'Global accessibility and language controls'}
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}
                className="touch-target px-3.5 py-2 text-xs sm:text-sm font-semibold border rounded-md transition-colors cursor-pointer"
                style={{
                  borderColor: 'var(--border-hairline)',
                  backgroundColor: 'var(--bg-paper)',
                  color: 'var(--ink-primary)',
                }}
              >
                {locale === 'ko' ? '언어: 한국어 / EN' : 'Lang: English / 한국어'}
              </button>

              <button
                type="button"
                onClick={() => setHighContrast(!highContrast)}
                aria-pressed={highContrast}
                className="touch-target px-3.5 py-2 text-xs sm:text-sm font-semibold border rounded-md transition-colors cursor-pointer"
                style={{
                  borderColor: highContrast ? 'var(--border-strong)' : 'var(--border-hairline)',
                  backgroundColor: highContrast ? 'var(--ink-primary)' : 'var(--bg-paper)',
                  color: highContrast ? 'var(--bg-paper)' : 'var(--ink-primary)',
                }}
              >
                {locale === 'ko'
                  ? highContrast
                    ? '고대비 모드 켜짐'
                    : '고대비 모드'
                  : highContrast
                    ? 'High Contrast: ON'
                    : 'High Contrast'}
              </button>
            </nav>
          </div>

          {/* 2개 메뉴 탭 바: [1. 공개 연재 에피소드] | [2. 작가 · 출판사 원고 등록 데스크] */}
          <div
            role="tablist"
            aria-label={locale === 'ko' ? '서비스 주요 메뉴 탭' : 'Primary service navigation tabs'}
            className="flex items-center gap-1 sm:gap-2 border-t pt-1"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <button
              type="button"
              role="tab"
              id="tab-btn-library"
              aria-selected={activeTab === 'library'}
              aria-controls="tabpanel-library"
              data-testid="tab-library"
              onClick={() => setActiveTab('library')}
              className="touch-target px-4 sm:px-5 py-3 text-sm sm:text-base font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2"
              style={{
                borderBottomColor:
                  activeTab === 'library' ? 'var(--accent-vermilion)' : 'transparent',
                color:
                  activeTab === 'library' ? 'var(--ink-primary)' : 'var(--ink-muted)',
              }}
            >
              <span>{locale === 'ko' ? '공개 연재 에피소드' : 'Published Episodes'}</span>
              <span
                className="text-xs px-2 py-0.5 rounded-full tabular-nums font-semibold"
                style={{
                  backgroundColor:
                    activeTab === 'library' ? 'var(--accent-vermilion)' : 'var(--bg-subtle)',
                  color: activeTab === 'library' ? '#ffffff' : 'var(--ink-secondary)',
                }}
              >
                {episodes.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-btn-desk"
              aria-selected={activeTab === 'desk'}
              aria-controls="tabpanel-desk"
              data-testid="tab-desk"
              onClick={() => setActiveTab('desk')}
              className="touch-target px-4 sm:px-5 py-3 text-sm sm:text-base font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2"
              style={{
                borderBottomColor:
                  activeTab === 'desk' ? 'var(--accent-vermilion)' : 'transparent',
                color:
                  activeTab === 'desk' ? 'var(--ink-primary)' : 'var(--ink-muted)',
              }}
            >
              <span>
                {locale === 'ko'
                  ? '작가 · 출판사 원고 등록 데스크'
                  : 'Creator & Publisher Manuscript Desk'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {activeTab === 'library' ? (
          <div
            id="tabpanel-library"
            role="tabpanel"
            aria-labelledby="tab-btn-library"
            className="space-y-10"
          >
            {/* 에디토리얼 인트로 배너 */}
            <section
              aria-labelledby="editorial-intro-heading"
              className="editorial-card rounded-xl p-6 sm:p-8 border"
              style={{ borderColor: 'var(--border-hairline)' }}
            >
              <div className="max-w-3xl space-y-3">
                <p
                  className="text-xs font-bold tracking-wider uppercase"
                  style={{ color: 'var(--accent-vermilion)' }}
                >
                  {locale === 'ko'
                    ? '시각장애인 독자와 웹툰 창작자를 잇는 배리어프리 오디오 에디션'
                    : 'Barrier-Free Audio Edition for Webtoon Readers & Creators'}
                </p>
                <h1
                  id="editorial-intro-heading"
                  className="font-editorial text-2xl sm:text-4xl font-bold tracking-tight leading-snug"
                >
                  {locale === 'ko'
                    ? '컷의 구도와 인물의 호흡까지 소리로 읽는 웹툰 서재'
                    : 'Experience Every Webtoon Cut Through Scene Narration & Cast Voices'}
                </h1>
                <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                  {locale === 'ko'
                    ? '세로 스크롤 웹툰 원고를 컷 단위로 정밀하게 읽어 내려가며 장면의 시각적 연출, 등장인물별 성우 연기, 음향 효과를 하나의 흐름으로 엮었습니다. 스크린리더와 키보드 단축키(Space, 화살표, J/K)만으로 모든 회차를 온전히 감상할 수 있습니다.'
                    : 'Vertical-scroll webtoon manuscripts are crafted cut by cut into rich scene descriptions, distinct character voices, and sound effects—fully operable via keyboard shortcuts and screen readers.'}
                </p>
              </div>
            </section>

            {/* 공개 연재 에피소드 서재 목록 */}
            <section aria-labelledby="published-library-heading" className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-4" style={{ borderColor: 'var(--border-hairline)' }}>
                <div>
                  <h2 id="published-library-heading" className="text-xl sm:text-2xl font-bold tracking-tight">
                    {locale === 'ko' ? '공개 연재 에피소드' : 'Published Barrier-Free Episodes'}
                  </h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
                    {locale === 'ko'
                      ? '검증을 마치고 서재에 공개된 작품입니다. 작품을 선택하면 배리어프리 오디오 리더로 즉시 연결됩니다.'
                      : 'Verified and published episodes ready for screen-reader and audio playback.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('desk')}
                  className="touch-target px-4 py-2 text-xs sm:text-sm font-semibold border rounded-md transition-colors cursor-pointer"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  {locale === 'ko' ? '+ 새 웹툰 원고 등록하기 →' : '+ Upload New Manuscript →'}
                </button>
              </div>

              <div aria-live="polite" className="sr-only">
                {loading
                  ? locale === 'ko'
                    ? '작품 목록을 불러오는 중입니다.'
                    : 'Loading published episodes.'
                  : locale === 'ko'
                    ? `총 ${episodes.length}개의 공개 에피소드가 있습니다.`
                    : `${episodes.length} published episodes available.`}
              </div>

              {loading ? (
                <div className="editorial-card p-10 rounded-xl text-center">
                  {locale === 'ko' ? '서재 목록을 불러오는 중입니다...' : 'Loading library...'}
                </div>
              ) : episodes.length === 0 ? (
                <div className="editorial-card p-10 rounded-xl space-y-3 text-center">
                  <p className="font-bold text-lg">
                    {locale === 'ko'
                      ? '현재 공개된 에피소드가 없습니다.'
                      : 'No published episodes yet.'}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                    {locale === 'ko'
                      ? '상단 메뉴의 [작가 · 출판사 원고 등록 데스크] 탭에서 새 웹툰 원고를 등록해 보세요.'
                      : 'Switch to the [Creator & Publisher Manuscript Desk] tab above to upload an episode.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {episodes.map((ep) => {
                    const revId = ep.publishedRevisionId || ep.activeDraftRevisionId;
                    const coverAssetId = ep.coverImageAssetId || 'src_001';
                    const coverUrl = `/api/assets/${ep.episodeId}/${revId}/source/${coverAssetId}${
                      highContrast ? '?contrast=high' : ''
                    }`;

                    return (
                      <article
                        key={ep.episodeId}
                        className="editorial-card rounded-xl overflow-hidden transition-all"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-12">
                          {/* 좌측: 실제 웹툰 원고 표지 아트워크 썸네일 */}
                          <div
                            className="md:col-span-4 lg:col-span-3 border-b md:border-b-0 md:border-r relative overflow-hidden flex items-center justify-center min-h-[240px] max-h-[340px]"
                            style={{
                              borderColor: 'var(--border-hairline)',
                              backgroundColor: '#181816',
                            }}
                          >
                            <img
                              src={coverUrl}
                              data-contrast-mode={highContrast ? 'high' : 'normal'}
                              alt={
                                locale === 'ko'
                                  ? `${ep.titleKo} 대표 원고 표지`
                                  : `${ep.titleEn} manuscript cover`
                              }
                              className="w-full h-full object-cover object-top"
                            />
                            <div
                              className="absolute bottom-3 left-3 right-3 px-3 py-1.5 rounded-md text-xs font-semibold flex items-center justify-between"
                              style={{
                                backgroundColor: 'rgba(20, 20, 19, 0.86)',
                                color: '#ffffff',
                              }}
                            >
                              <span>{locale === 'ko' ? '정식 배리어프리판' : 'Verified Edition'}</span>
                              <span className="tabular-nums">{ep.panelCount} Cuts</span>
                            </div>
                          </div>

                          {/* 우측: 서지 정보, 작품 해설 및 감상 액션 */}
                          <div className="md:col-span-8 lg:col-span-9 p-6 sm:p-8 flex flex-col justify-between gap-6">
                            <div className="space-y-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="text-xs font-bold px-2.5 py-1 rounded-md"
                                  style={{
                                    backgroundColor: 'var(--accent-pine)',
                                    color: '#ffffff',
                                  }}
                                >
                                  {locale === 'ko'
                                    ? '한국어 · 영어 다중 성우 오디오 완비'
                                    : 'KO · EN Multi-Voice Audio'}
                                </span>
                                <span
                                  className="text-xs font-semibold px-2.5 py-1 rounded-md tabular-nums"
                                  style={{
                                    backgroundColor: 'var(--bg-subtle)',
                                    color: 'var(--ink-secondary)',
                                  }}
                                >
                                  {locale === 'ko'
                                    ? `총 ${ep.panelCount}컷 · 성우 보이스 ${ep.characterCount}인 참여`
                                    : `${ep.panelCount} Cuts · ${ep.characterCount} Character Voices`}
                                </span>
                              </div>

                              <div>
                                <h3 className="font-editorial text-2xl sm:text-3xl font-bold leading-snug">
                                  {locale === 'ko' ? ep.titleKo : ep.titleEn}
                                </h3>
                                <p
                                  className="text-sm font-semibold mt-1.5"
                                  style={{ color: 'var(--ink-secondary)' }}
                                >
                                  {locale === 'ko'
                                    ? `글 · 그림: ${ep.authorName}`
                                    : `Created by ${ep.authorName}`}
                                </p>
                              </div>

                              <p
                                className="text-sm sm:text-base leading-relaxed"
                                style={{ color: 'var(--ink-secondary)' }}
                              >
                                {locale === 'ko'
                                  ? ep.summaryKo ||
                                    '컷별 장면 해설과 등장인물 다중 보이스 연기가 결합된 배리어프리 웹툰 에피소드입니다.'
                                  : ep.summaryEn ||
                                    'Barrier-free webtoon episode with full scene narration and multi-character voices.'}
                              </p>
                            </div>

                            <div
                              className="pt-5 border-t flex flex-wrap items-center justify-between gap-3"
                              style={{ borderColor: 'var(--border-hairline)' }}
                            >
                              <div className="flex flex-wrap items-center gap-3">
                                <Link
                                  href={`/read/${ep.episodeId}?lang=${locale}`}
                                  className="touch-target inline-flex items-center justify-center px-6 py-3 rounded-lg font-bold text-sm no-underline transition-opacity"
                                  style={{
                                    backgroundColor: 'var(--accent-vermilion)',
                                    color: '#ffffff',
                                  }}
                                >
                                  {locale === 'ko'
                                    ? '배리어프리 오디오 리더로 감상하기'
                                    : 'Listen in Barrier-Free Reader'}
                                </Link>

                                <Link
                                  href={`/studio/${ep.episodeId}`}
                                  className="touch-target inline-flex items-center justify-center px-4 py-3 rounded-lg font-semibold text-sm border no-underline transition-colors"
                                  style={{
                                    borderColor: 'var(--border-hairline)',
                                    backgroundColor: 'var(--bg-paper)',
                                    color: 'var(--ink-primary)',
                                  }}
                                >
                                  {locale === 'ko' ? '접근성 커스텀 스튜디오' : 'Customize in Studio'}
                                </Link>
                              </div>

                              <span className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                                {locale === 'ko'
                                  ? '스크린리더 · 키보드 단축키 완벽 지원'
                                  : 'Screen-Reader & Keyboard Ready'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* 탭 2: 작가 · 출판사 원고 등록 데스크 (별도 로그인/토큰 없이 누구나 즉시 사용 가능한 MVP 오픈 데스크) */
          <div
            id="tabpanel-desk"
            role="tabpanel"
            aria-labelledby="tab-btn-desk"
            className="space-y-10"
          >
            <section aria-labelledby="publisher-desk-heading" className="space-y-6">
              <div className="border-b pb-5 flex flex-wrap items-end justify-between gap-4" style={{ borderColor: 'var(--border-hairline)' }}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: 'var(--accent-pine)',
                        color: '#ffffff',
                      }}
                    >
                      {locale === 'ko' ? '오픈 스튜디오 (로그인 불필요)' : 'Open MVP Desk (No Login Required)'}
                    </span>
                  </div>
                  <h1 id="publisher-desk-heading" className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight">
                    {locale === 'ko'
                      ? '작가 · 출판사 원고 등록 데스크'
                      : 'Creator & Publisher Manuscript Desk'}
                  </h1>
                  <p className="text-sm sm:text-base" style={{ color: 'var(--ink-secondary)' }}>
                    {locale === 'ko'
                      ? '누구나 별도의 토큰이나 로그인 없이 웹툰 원고를 업로드하여 AI에게 전체 구성을 맡기는 [바로 등록] 또는 대사·보이스·효과음을 세밀하게 연출하는 [접근성 커스텀]을 이용할 수 있습니다.'
                      : 'Upload webtoon manuscript strips without any login token—choose one-click [Auto Publish] or open the [Accessibility Customization] workbench.'}
                  </p>
                </div>
              </div>

              {/* 신규 웹툰 원고 업로드 폼 */}
              <form
                onSubmit={handleManuscriptUpload}
                className="editorial-card p-6 sm:p-8 rounded-xl space-y-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4" style={{ borderColor: 'var(--border-hairline)' }}>
                  <h2 className="text-lg sm:text-xl font-bold">
                    {locale === 'ko' ? '신규 에피소드 원고 업로드' : 'Upload New Episode Manuscript'}
                  </h2>
                  <span className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                    {locale === 'ko'
                      ? 'JPG · PNG · WEBP 세로 스트립 다중 업로드 지원'
                      : 'Supports multi-file JPG, PNG, WEBP vertical strips'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="ep-title-ko" className="block text-sm font-bold mb-1.5">
                      {locale === 'ko' ? '작품 및 회차 제목 (한국어)' : 'Episode Title (Korean)'}
                    </label>
                    <input
                      id="ep-title-ko"
                      type="text"
                      required
                      value={titleKo}
                      onChange={(e) => setTitleKo(e.target.value)}
                      placeholder="예: 나 혼자 만렙 뉴비 — 02화. 서막"
                      className="touch-target w-full px-3.5 py-2.5 border rounded-lg text-sm"
                      style={{
                        borderColor: 'var(--border-hairline)',
                        backgroundColor: 'var(--bg-paper)',
                        color: 'var(--ink-primary)',
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="ep-title-en" className="block text-sm font-bold mb-1.5">
                      {locale === 'ko' ? '작품 및 회차 제목 (영어)' : 'Episode Title (English)'}
                    </label>
                    <input
                      id="ep-title-en"
                      type="text"
                      required
                      value={titleEn}
                      onChange={(e) => setTitleEn(e.target.value)}
                      placeholder="e.g., Solo Max-Level Newbie — Ep. 02 Prologue"
                      className="touch-target w-full px-3.5 py-2.5 border rounded-lg text-sm"
                      style={{
                        borderColor: 'var(--border-hairline)',
                        backgroundColor: 'var(--bg-paper)',
                        color: 'var(--ink-primary)',
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="ep-author" className="block text-sm font-bold mb-1.5">
                      {locale === 'ko' ? '작가 / 스튜디오명' : 'Creator / Studio Name'}
                    </label>
                    <input
                      id="ep-author"
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      placeholder="예: 메슬로우 · 스윙배트 · WAN.Z"
                      className="touch-target w-full px-3.5 py-2.5 border rounded-lg text-sm"
                      style={{
                        borderColor: 'var(--border-hairline)',
                        backgroundColor: 'var(--bg-paper)',
                        color: 'var(--ink-primary)',
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="ep-files" className="block text-sm font-bold mb-1.5">
                      {locale === 'ko'
                        ? '원고 이미지 파일 (다중 선택 가능, 파일명 순 자동 정렬)'
                        : 'Manuscript Strip Images (Multi-select)'}
                    </label>
                    <input
                      id="ep-files"
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) =>
                        setSelectedFiles(e.target.files ? Array.from(e.target.files) : [])
                      }
                      className="touch-target w-full px-3 py-2 border rounded-lg text-sm"
                      style={{
                        borderColor: 'var(--border-hairline)',
                        backgroundColor: 'var(--bg-paper)',
                        color: 'var(--ink-primary)',
                      }}
                    />
                    {selectedFiles.length > 0 && (
                      <p className="text-xs mt-1 font-medium" style={{ color: 'var(--accent-pine)' }}>
                        {locale === 'ko'
                          ? `선택된 원고 파일: ${selectedFiles.length}장`
                          : `${selectedFiles.length} strip files selected`}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="ep-summary-ko" className="block text-sm font-bold mb-1.5">
                      {locale === 'ko' ? '회차 줄거리 요약 (선택)' : 'Episode Synopsis (Optional)'}
                    </label>
                    <input
                      id="ep-summary-ko"
                      type="text"
                      value={summaryKo}
                      onChange={(e) => {
                        setSummaryKo(e.target.value);
                        if (!summaryEn) setSummaryEn(e.target.value);
                      }}
                      placeholder={
                        locale === 'ko'
                          ? '독자 서재 카드에 표시될 회차 소개 문구를 입력해 주세요.'
                          : 'Brief synopsis displayed on the library card.'
                      }
                      className="touch-target w-full px-3.5 py-2.5 border rounded-lg text-sm"
                      style={{
                        borderColor: 'var(--border-hairline)',
                        backgroundColor: 'var(--bg-paper)',
                        color: 'var(--ink-primary)',
                      }}
                    />
                  </div>
                </div>

                <fieldset className="space-y-3 pt-2">
                  <legend className="text-sm font-bold">
                    {locale === 'ko' ? '출판 경로 선택' : 'Select Publishing Path'}
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label
                      className="p-5 border-2 rounded-xl flex items-start gap-3.5 cursor-pointer transition-colors"
                      style={{
                        borderColor:
                          publishMode === 'auto_publish'
                            ? 'var(--accent-vermilion)'
                            : 'var(--border-hairline)',
                        backgroundColor:
                          publishMode === 'auto_publish'
                            ? 'var(--bg-paper)'
                            : 'var(--bg-card)',
                      }}
                    >
                      <input
                        type="radio"
                        name="publishMode"
                        value="auto_publish"
                        checked={publishMode === 'auto_publish'}
                        onChange={() => setPublishMode('auto_publish')}
                        className="mt-1"
                      />
                      <div>
                        <div className="font-bold text-sm sm:text-base">
                          {locale === 'ko'
                            ? '바로 등록 (Auto Publish)'
                            : 'Auto Publish (One-Shot)'}
                        </div>
                        <p className="text-xs sm:text-sm mt-1 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                          {locale === 'ko'
                            ? 'AI가 컷 분할, 장면 해설, 다중 캐릭터 보이스 배정, 효과음 매칭, 품질 검증까지 자동으로 마친 뒤 서재에 즉시 공개합니다.'
                            : 'Automatically analyzes cuts, assigns character voices, synthesizes KO/EN audio, validates, and publishes immediately.'}
                        </p>
                      </div>
                    </label>

                    <label
                      className="p-5 border-2 rounded-xl flex items-start gap-3.5 cursor-pointer transition-colors"
                      style={{
                        borderColor:
                          publishMode === 'custom'
                            ? 'var(--accent-vermilion)'
                            : 'var(--border-hairline)',
                        backgroundColor:
                          publishMode === 'custom'
                            ? 'var(--bg-paper)'
                            : 'var(--bg-card)',
                      }}
                    >
                      <input
                        type="radio"
                        name="publishMode"
                        value="custom"
                        checked={publishMode === 'custom'}
                        onChange={() => setPublishMode('custom')}
                        className="mt-1"
                      />
                      <div>
                        <div className="font-bold text-sm sm:text-base">
                          {locale === 'ko'
                            ? '접근성 커스텀 (Studio Customization)'
                            : 'Accessibility Customization'}
                        </div>
                        <p className="text-xs sm:text-sm mt-1 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                          {locale === 'ko'
                            ? '초기 AI 분석 후 커스텀 스튜디오를 열어 캐릭터 보이스, 스포일러 방지 가명, 효과음, 컷 전환 호흡을 직접 다듬고 게시합니다.'
                            : 'Opens the Studio Workbench after initial analysis to fine-tune voices, spoiler masks, SFX, and hold times before publishing.'}
                        </p>
                      </div>
                    </label>
                  </div>
                </fieldset>

                {submitStatus && (
                  <p
                    role="status"
                    className="p-3.5 rounded-lg text-sm font-semibold border"
                    style={{
                      borderColor: 'var(--accent-pine)',
                      backgroundColor: 'var(--bg-paper)',
                      color: 'var(--accent-pine)',
                    }}
                  >
                    {submitStatus}
                  </p>
                )}
                {submitError && (
                  <p
                    role="alert"
                    className="p-3.5 rounded-lg text-sm font-semibold border"
                    style={{
                      borderColor: 'var(--accent-vermilion)',
                      backgroundColor: 'var(--bg-paper)',
                      color: 'var(--accent-vermilion)',
                    }}
                  >
                    {submitError}
                  </p>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="touch-target px-6 py-3 rounded-lg font-bold text-sm cursor-pointer disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--accent-vermilion)',
                      color: '#ffffff',
                    }}
                  >
                    {submitting
                      ? locale === 'ko'
                        ? '원고 처리 및 분석 중...'
                        : 'Processing Manuscript...'
                      : publishMode === 'auto_publish'
                        ? locale === 'ko'
                          ? '원고 업로드 및 바로 등록 시작'
                          : 'Upload & Auto Publish'
                        : locale === 'ko'
                          ? '원고 업로드 및 커스텀 스튜디오 열기'
                          : 'Upload & Open Custom Studio'}
                  </button>
                </div>
              </form>

              {/* 기존 등록 에피소드 커스텀 편집 목록 */}
              <div className="editorial-card rounded-xl overflow-hidden">
                <div
                  className="px-6 py-4 border-b flex items-center justify-between"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <div>
                    <h2 className="text-base font-bold">
                      {locale === 'ko'
                        ? '등록된 에피소드 및 접근성 커스텀 스튜디오 관리'
                        : 'Registered Episodes & Studio Workbench'}
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                      {locale === 'ko'
                        ? '등록된 모든 회차의 등장인물 보이스, 장면 해설, 대사 호흡을 언제든 스튜디오에서 수정할 수 있습니다.'
                        : 'Open any episode in the Studio Workbench to customize character voices, scene narration, and pacing.'}
                    </p>
                  </div>
                  <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--ink-primary)' }}>
                    {studioEpisodes.length} {locale === 'ko' ? '개 작품' : 'episodes'}
                  </span>
                </div>

                <div className="divide-y" style={{ borderColor: 'var(--border-hairline)' }}>
                  {studioEpisodes.map((ep) => {
                    const isDeletingThis = deleteTargetId === ep.episodeId;
                    return (
                      <div
                        key={ep.episodeId}
                        className="px-6 py-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="text-xs font-bold px-2 py-0.5 rounded"
                                style={{
                                  backgroundColor:
                                    ep.status === 'published'
                                      ? 'var(--accent-pine)'
                                      : 'var(--bg-subtle)',
                                  color:
                                    ep.status === 'published'
                                      ? '#ffffff'
                                      : 'var(--ink-secondary)',
                                }}
                              >
                                {ep.status === 'published'
                                  ? locale === 'ko'
                                    ? '공개 연재 중'
                                    : 'Published'
                                  : locale === 'ko'
                                    ? '초안 편집 중'
                                    : 'Draft'}
                              </span>
                              <span className="font-bold text-base">
                                {locale === 'ko' ? ep.titleKo : ep.titleEn}
                              </span>
                            </div>
                            <div className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                              {ep.authorName} ·{' '}
                              {locale === 'ko'
                                ? `원고 스트립 ${ep.sourceImageCount}장 · 분석된 컷 ${ep.panelCount}개 · 성우 보이스 ${ep.characterCount}명`
                                : `${ep.sourceImageCount} strips · ${ep.panelCount} cuts · ${ep.characterCount} voices`}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            <Link
                              href={`/studio/${ep.episodeId}`}
                              className="touch-target inline-flex items-center px-4 py-2.5 rounded-lg text-xs sm:text-sm font-bold border no-underline"
                              style={{
                                borderColor: 'var(--border-strong)',
                                backgroundColor: 'var(--bg-paper)',
                                color: 'var(--ink-primary)',
                              }}
                            >
                              {locale === 'ko' ? '접근성 커스텀 스튜디오 열기' : 'Open Custom Studio'}
                            </Link>
                            {ep.publishedRevisionId && (
                              <Link
                                href={`/read/${ep.episodeId}`}
                                className="touch-target inline-flex items-center px-4 py-2.5 rounded-lg text-xs sm:text-sm font-bold no-underline"
                                style={{
                                  backgroundColor: 'var(--accent-vermilion)',
                                  color: '#ffffff',
                                }}
                              >
                                {locale === 'ko' ? '독자 리더 열기' : 'Open Reader'}
                              </Link>
                            )}
                            <button
                              type="button"
                              data-testid={`delete-episode-trigger-${ep.episodeId}`}
                              onClick={() => {
                                if (isDeletingThis) {
                                  setDeleteTargetId(null);
                                  setDeletePassword('');
                                  setDeleteError('');
                                } else {
                                  setDeleteTargetId(ep.episodeId);
                                  setDeletePassword('');
                                  setDeleteError('');
                                }
                              }}
                              className="touch-target px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold border cursor-pointer"
                              style={{
                                borderColor: isDeletingThis
                                  ? 'var(--accent-vermilion)'
                                  : 'var(--border-hairline)',
                                backgroundColor: 'var(--bg-card)',
                                color: 'var(--accent-vermilion)',
                              }}
                            >
                              {isDeletingThis
                                ? locale === 'ko'
                                  ? '삭제 취소'
                                  : 'Cancel'
                                : locale === 'ko'
                                  ? '원고 삭제'
                                  : 'Delete'}
                            </button>
                          </div>
                        </div>

                        {isDeletingThis && (
                          <form
                            onSubmit={(e) => handleDeleteEpisode(e, ep.episodeId)}
                            className="p-4 rounded-lg border flex flex-wrap items-center justify-between gap-3"
                            style={{
                              borderColor: 'var(--accent-vermilion)',
                              backgroundColor: 'var(--bg-paper)',
                            }}
                          >
                            <div className="space-y-0.5">
                              <label
                                htmlFor={`delete-pw-${ep.episodeId}`}
                                className="block text-xs font-bold"
                                style={{ color: 'var(--accent-vermilion)' }}
                              >
                                {locale === 'ko'
                                  ? '등록된 원고 삭제 확인 (비밀번호 입력 필수)'
                                  : 'Confirm Manuscript Deletion (Password Required)'}
                              </label>
                              <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                                {locale === 'ko'
                                  ? '실수로 원고가 삭제되는 것을 방지하기 위해 삭제 비밀번호를 입력해 주세요.'
                                  : 'Enter the deletion password to permanently remove this episode.'}
                              </p>
                              {deleteError && (
                                <p
                                  role="alert"
                                  className="text-xs font-bold pt-1"
                                  style={{ color: 'var(--accent-vermilion)' }}
                                >
                                  {deleteError}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                id={`delete-pw-${ep.episodeId}`}
                                data-testid={`delete-password-input-${ep.episodeId}`}
                                type="password"
                                required
                                value={deletePassword}
                                onChange={(e) => setDeletePassword(e.target.value)}
                                placeholder={
                                  locale === 'ko' ? '삭제 비밀번호 입력' : 'Delete password'
                                }
                                className="touch-target px-3 py-2 border rounded-md text-xs sm:text-sm"
                                style={{
                                  borderColor: 'var(--border-hairline)',
                                  backgroundColor: 'var(--bg-card)',
                                  color: 'var(--ink-primary)',
                                }}
                              />
                              <button
                                type="submit"
                                disabled={deleting}
                                data-testid={`confirm-delete-btn-${ep.episodeId}`}
                                className="touch-target px-4 py-2 rounded-md text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50"
                                style={{
                                  backgroundColor: 'var(--accent-vermilion)',
                                  color: '#ffffff',
                                }}
                              >
                                {deleting
                                  ? locale === 'ko'
                                    ? '삭제 중...'
                                    : 'Deleting...'
                                  : locale === 'ko'
                                    ? '영구 삭제 확인'
                                    : 'Confirm Delete'}
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      <footer
        className="border-t mt-16"
        style={{
          borderColor: 'var(--border-hairline)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs" style={{ color: 'var(--ink-muted)' }}>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="PanelCast" className="h-5 w-auto object-contain brand-logo" />
            <span>
              {locale === 'ko'
                ? '시각장애인 독자를 위한 배리어프리 웹툰 오디오 출판 표준'
                : 'Barrier-Free Webtoon Audio Publishing Platform'}
            </span>
          </div>
          <div>
            {locale === 'ko'
              ? '키보드 단축키: Space (재생/일시정지) · ←/→ 또는 K/J (이전/다음 컷) · R (현재 컷 다시 듣기) · L (한/영 전환)'
              : 'Shortcuts: Space (Play/Pause) · ←/→ or K/J (Prev/Next Cut) · R (Replay Cut) · L (Switch Lang)'}
          </div>
        </div>
      </footer>
    </div>
  );
}
