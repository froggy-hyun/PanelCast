'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Episode, LocaleCode, PublishMode } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const [locale, setLocale] = useState<LocaleCode>('ko');
  const [highContrast, setHighContrast] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [studioEpisodes, setStudioEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);

  const [isPublisher, setIsPublisher] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [showUploadPanel, setShowUploadPanel] = useState(false);

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
      const [pubRes, authRes] = await Promise.all([
        fetch('/api/episodes'),
        fetch('/api/auth/session'),
      ]);
      if (pubRes.ok) {
        const data = (await pubRes.json()) as { episodes: Episode[] };
        setEpisodes(data.episodes ?? []);
      }
      if (authRes.ok) {
        const authData = (await authRes.json()) as { authenticated: boolean };
        setIsPublisher(Boolean(authData.authenticated));
        if (authData.authenticated) {
          const allRes = await fetch('/api/episodes?includeDrafts=true');
          if (allRes.ok) {
            const allData = (await allRes.json()) as { episodes: Episode[] };
            setStudioEpisodes(allData.episodes ?? []);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  async function handlePublisherLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tokenInput }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setAuthError(
        err.error ||
          (locale === 'ko'
            ? '인증 토큰이 올바르지 않습니다.'
            : 'Invalid publisher token.'),
      );
      return;
    }
    setIsPublisher(true);
    setTokenInput('');
    await loadCatalog();
  }

  async function handlePublisherLogout() {
    await fetch('/api/auth/session', { method: 'DELETE' });
    setIsPublisher(false);
    setStudioEpisodes([]);
    setShowUploadPanel(false);
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
      formData.set('titleEn', titleEn || 'New Episode');
      formData.set('authorName', authorName || 'PanelCast Creator');
      formData.set('summaryKo', summaryKo);
      formData.set('summaryEn', summaryEn);
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
            ? '2/3 Gemini 멀티모달 컷 분석, 다중 화자 음성 합성 및 검증 중...'
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
      {/* 상단 편집부 헤더 */}
      <header
        className="border-b"
        style={{
          borderColor: 'var(--border-hairline)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <Link
              href="/"
              className="text-2xl font-bold tracking-tight no-underline"
              style={{ color: 'var(--ink-primary)' }}
            >
              PanelCast
            </Link>
            <span
              className="text-xs font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                color: 'var(--ink-secondary)',
              }}
            >
              {locale === 'ko' ? '배리어프리 웹툰 오디오 에디션' : 'Accessible Webtoon Audio Edition'}
            </span>
          </div>

          <nav
            aria-label={locale === 'ko' ? '전역 접근성 및 언어 설정' : 'Global accessibility and language controls'}
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}
              aria-label={
                locale === 'ko'
                  ? '언어를 영어로 전환 (Switch language to English)'
                  : 'Switch language to Korean (한국어로 전환)'
              }
              className="touch-target px-3.5 py-2 text-sm font-medium border rounded transition-colors cursor-pointer"
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
              className="touch-target px-3.5 py-2 text-sm font-medium border rounded transition-colors cursor-pointer"
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
      </header>

      <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-12">
        {/* 소개 배너 */}
        <section
          aria-labelledby="editorial-intro-heading"
          className="border-b pb-8"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          <div className="max-w-3xl space-y-3">
            <p
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: 'var(--accent-vermilion)' }}
            >
              {locale === 'ko'
                ? '시각장애인 독자와 웹툰 창작자를 잇는 표준 출판 워크플로'
                : 'Barrier-Free Publishing Workflow for Webtoon Creators & Blind Readers'}
            </p>
            <h1 id="editorial-intro-heading" className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
              {locale === 'ko'
                ? '컷의 구도와 인물의 호흡까지 소리로 읽는 웹툰 서재'
                : 'Read Every Webtoon Cut Through Scene Narration, Cast Voices & Sound'}
            </h1>
            <p className="text-base leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {locale === 'ko'
                ? 'PanelCast는 세로 스크롤 웹툰 원고를 컷 단위로 정밀 분석하여 장면 해설, 등장인물별 다중 음성 연기, 검증된 음향 효과를 결합한 배리어프리 에디션으로 출판합니다. 독자는 스크린리더와 키보드만으로 모든 컷을 순서대로 감상할 수 있습니다.'
                : 'PanelCast analyzes vertical-scroll webtoon manuscripts cut by cut—combining visual scene descriptions, multi-character voice acting, and reviewed sound effects into a synchronized barrier-free edition operable entirely via keyboard and screen readers.'}
            </p>
          </div>
        </section>

        {/* 공개 연재 작품 목록 */}
        <section aria-labelledby="published-library-heading" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="published-library-heading" className="text-2xl font-bold tracking-tight">
                {locale === 'ko' ? '공개 연재 에피소드' : 'Published Barrier-Free Episodes'}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
                {locale === 'ko'
                  ? '검증을 마치고 게시된 작품입니다. 작품을 선택하면 즉시 오디오 리더로 연결됩니다.'
                  : 'Verified and published episodes ready for screen-reader and audio playback.'}
              </p>
            </div>
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
            <div
              className="p-8 border rounded text-center"
              style={{
                borderColor: 'var(--border-hairline)',
                backgroundColor: 'var(--bg-card)',
              }}
            >
              {locale === 'ko' ? '작품 목록을 불러오는 중입니다...' : 'Loading episodes...'}
            </div>
          ) : episodes.length === 0 ? (
            <div
              className="p-8 border rounded space-y-2"
              style={{
                borderColor: 'var(--border-hairline)',
                backgroundColor: 'var(--bg-card)',
              }}
            >
              <p className="font-semibold">
                {locale === 'ko'
                  ? '현재 공개된 에피소드가 없습니다.'
                  : 'No published episodes yet.'}
              </p>
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                {locale === 'ko'
                  ? '하단의 작가/출판사 스튜디오에서 원고를 등록해 주세요.'
                  : 'Use the Publisher Studio desk below to upload and publish an episode.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {episodes.map((ep) => (
                <article
                  key={ep.episodeId}
                  className="border rounded flex flex-col justify-between p-6 transition-shadow"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-card)',
                  }}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-xs font-bold px-2.5 py-1 rounded"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          color: 'var(--accent-pine)',
                        }}
                      >
                        {locale === 'ko' ? '한국어 · 영어 음성 지원' : 'KO · EN Audio Ready'}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                        {locale === 'ko'
                          ? `총 ${ep.panelCount}컷 · 등장인물 ${ep.characterCount}명`
                          : `${ep.panelCount} Cuts · ${ep.characterCount} Voices`}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xl font-bold leading-snug">
                        {locale === 'ko' ? ep.titleKo : ep.titleEn}
                      </h3>
                      <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-secondary)' }}>
                        {locale === 'ko' ? `글/그림: ${ep.authorName}` : `By ${ep.authorName}`}
                      </p>
                    </div>

                    <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                      {locale === 'ko'
                        ? ep.summaryKo || '장면 해설과 다중 성우 보이스가 결합된 배리어프리 웹툰 에피소드입니다.'
                        : ep.summaryEn || 'Barrier-free webtoon episode with full scene narration and multi-character voices.'}
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--border-hairline)' }}>
                    <Link
                      href={`/read/${ep.episodeId}?lang=${locale}`}
                      className="touch-target inline-flex items-center justify-center px-5 py-2.5 rounded font-semibold text-sm no-underline"
                      style={{
                        backgroundColor: 'var(--accent-vermilion)',
                        color: '#ffffff',
                      }}
                    >
                      {locale === 'ko'
                        ? '배리어프리 오디오 리더로 감상하기'
                        : 'Listen in Barrier-Free Reader'}
                    </Link>

                    {isPublisher && (
                      <Link
                        href={`/studio/${ep.episodeId}`}
                        className="touch-target inline-flex items-center justify-center px-4 py-2 rounded font-medium text-sm border no-underline"
                        style={{
                          borderColor: 'var(--border-hairline)',
                          color: 'var(--ink-primary)',
                        }}
                      >
                        {locale === 'ko' ? '접근성 커스텀 편집' : 'Customize in Studio'}
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* 작가 및 출판사 스튜디오 섹션 */}
        <section
          aria-labelledby="publisher-desk-heading"
          className="border-t pt-10 space-y-6"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="publisher-desk-heading" className="text-2xl font-bold tracking-tight">
                {locale === 'ko'
                  ? '작가 · 출판사 원고 등록 데스크'
                  : 'Creator & Publisher Manuscript Desk'}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>
                {locale === 'ko'
                  ? '원고 마감 직후 AI에게 전체 구성을 맡기는 [바로 등록]과 캐릭터 보이스·효과음·컷 호흡을 세밀하게 다듬는 [접근성 커스텀] 두 가지 경로를 지원합니다.'
                  : 'Supports both one-click [Auto Publish] for tight deadlines and [Accessibility Customization] for fine-grained voice, SFX, and pacing direction.'}
              </p>
            </div>

            {isPublisher && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadPanel(!showUploadPanel)}
                  className="touch-target px-4 py-2.5 rounded font-semibold text-sm cursor-pointer"
                  style={{
                    backgroundColor: 'var(--ink-primary)',
                    color: 'var(--bg-paper)',
                  }}
                >
                  {showUploadPanel
                    ? locale === 'ko'
                      ? '원고 등록 창 닫기'
                      : 'Close Upload Form'
                    : locale === 'ko'
                      ? '+ 새 웹툰 원고 등록'
                      : '+ Upload New Manuscript'}
                </button>
                <button
                  type="button"
                  onClick={handlePublisherLogout}
                  className="touch-target px-3.5 py-2.5 rounded text-sm border cursor-pointer"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  {locale === 'ko' ? '출판사 로그아웃' : 'Sign Out'}
                </button>
              </div>
            )}
          </div>

          {!isPublisher ? (
            <form
              onSubmit={handlePublisherLogin}
              className="p-6 border rounded max-w-xl space-y-4"
              style={{
                borderColor: 'var(--border-hairline)',
                backgroundColor: 'var(--bg-card)',
              }}
            >
              <div>
                <label htmlFor="publisher-token-input" className="block text-sm font-semibold mb-1">
                  {locale === 'ko'
                    ? '출판사 / 작가 스튜디오 인증 키'
                    : 'Publisher / Creator Studio Access Token'}
                </label>
                <p className="text-xs mb-3" style={{ color: 'var(--ink-muted)' }}>
                  {locale === 'ko'
                    ? '미공개 원고 보호 및 보이스 커스텀 편집을 위해 출판사 인증이 필요합니다.'
                    : 'Authentication is required to upload manuscripts or edit unpublished drafts.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="publisher-token-input"
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={
                      locale === 'ko' ? '인증 토큰 입력' : 'Enter publisher token'
                    }
                    className="touch-target flex-1 px-3.5 py-2 border rounded text-sm"
                    style={{
                      borderColor: 'var(--border-hairline)',
                      backgroundColor: 'var(--bg-paper)',
                      color: 'var(--ink-primary)',
                    }}
                  />
                  <button
                    type="submit"
                    className="touch-target px-5 py-2 rounded font-semibold text-sm cursor-pointer"
                    style={{
                      backgroundColor: 'var(--accent-vermilion)',
                      color: '#ffffff',
                    }}
                  >
                    {locale === 'ko' ? '스튜디오 잠금 해제' : 'Unlock Studio'}
                  </button>
                </div>
              </div>
              {authError && (
                <p role="alert" className="text-sm font-medium" style={{ color: 'var(--accent-vermilion)' }}>
                  {authError}
                </p>
              )}
            </form>
          ) : (
            <div className="space-y-6">
              {showUploadPanel && (
                <form
                  onSubmit={handleManuscriptUpload}
                  className="p-6 border rounded space-y-6"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-card)',
                  }}
                >
                  <h3 className="text-lg font-bold">
                    {locale === 'ko' ? '신규 에피소드 원고 업로드' : 'Upload New Episode Manuscript'}
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="ep-title-ko" className="block text-sm font-semibold mb-1">
                        {locale === 'ko' ? '작품 및 회차 제목 (한국어)' : 'Episode Title (Korean)'}
                      </label>
                      <input
                        id="ep-title-ko"
                        type="text"
                        required
                        value={titleKo}
                        onChange={(e) => setTitleKo(e.target.value)}
                        placeholder="예: 나 혼자 만렙 뉴비 - 02화. 서막"
                        className="touch-target w-full px-3 py-2 border rounded text-sm"
                        style={{ borderColor: 'var(--border-hairline)' }}
                      />
                    </div>

                    <div>
                      <label htmlFor="ep-title-en" className="block text-sm font-semibold mb-1">
                        {locale === 'ko' ? '작품 및 회차 제목 (영어)' : 'Episode Title (English)'}
                      </label>
                      <input
                        id="ep-title-en"
                        type="text"
                        required
                        value={titleEn}
                        onChange={(e) => setTitleEn(e.target.value)}
                        placeholder="e.g., Solo Max-Level Newbie - Ep. 02 Prologue"
                        className="touch-target w-full px-3 py-2 border rounded text-sm"
                        style={{ borderColor: 'var(--border-hairline)' }}
                      />
                    </div>

                    <div>
                      <label htmlFor="ep-author" className="block text-sm font-semibold mb-1">
                        {locale === 'ko' ? '작가 / 스튜디오명' : 'Creator / Studio Name'}
                      </label>
                      <input
                        id="ep-author"
                        type="text"
                        value={authorName}
                        onChange={(e) => setAuthorName(e.target.value)}
                        placeholder="예: 메슬로우 · 스윙배트 · WAN.Z"
                        className="touch-target w-full px-3 py-2 border rounded text-sm"
                        style={{ borderColor: 'var(--border-hairline)' }}
                      />
                    </div>

                    <div>
                      <label htmlFor="ep-files" className="block text-sm font-semibold mb-1">
                        {locale === 'ko'
                          ? '원고 이미지 파일 (다중 선택 가능, 자동 순서 정렬)'
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
                        className="touch-target w-full px-3 py-1.5 border rounded text-sm"
                        style={{ borderColor: 'var(--border-hairline)' }}
                      />
                    </div>
                  </div>

                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">
                      {locale === 'ko' ? '출판 경로 선택' : 'Select Publishing Path'}
                    </legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label
                        className="p-4 border rounded flex items-start gap-3 cursor-pointer"
                        style={{
                          borderColor:
                            publishMode === 'auto_publish'
                              ? 'var(--accent-vermilion)'
                              : 'var(--border-hairline)',
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
                          <div className="font-bold text-sm">
                            {locale === 'ko'
                              ? '바로 등록 (Auto Publish)'
                              : 'Auto Publish (One-Shot)'}
                          </div>
                          <p className="text-xs mt-1" style={{ color: 'var(--ink-secondary)' }}>
                            {locale === 'ko'
                              ? 'AI가 컷 분할, 장면 해설, 다중 캐릭터 보이스 배정, 효과음 매칭, 품질 검증까지 자동으로 마친 뒤 즉시 공개합니다.'
                              : 'Automatically analyzes cuts, assigns character voices, synthesizes KO/EN audio, validates, and publishes immediately.'}
                          </p>
                        </div>
                      </label>

                      <label
                        className="p-4 border rounded flex items-start gap-3 cursor-pointer"
                        style={{
                          borderColor:
                            publishMode === 'custom'
                              ? 'var(--accent-vermilion)'
                              : 'var(--border-hairline)',
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
                          <div className="font-bold text-sm">
                            {locale === 'ko'
                              ? '접근성 커스텀 (Studio Customization)'
                              : 'Accessibility Customization'}
                          </div>
                          <p className="text-xs mt-1" style={{ color: 'var(--ink-secondary)' }}>
                            {locale === 'ko'
                              ? '초기 AI 분석 후 스튜디오에서 캐릭터 보이스, 스포일러 방지 시점, 효과음, 컷 전환 대기 시간을 다듬고 선택 재생성 후 게시합니다.'
                              : 'Opens the Studio Workbench after initial analysis to fine-tune voices, spoiler masks, SFX, and hold times before publishing.'}
                          </p>
                        </div>
                      </label>
                    </div>
                  </fieldset>

                  {submitStatus && (
                    <p role="status" className="text-sm font-medium" style={{ color: 'var(--accent-pine)' }}>
                      {submitStatus}
                    </p>
                  )}
                  {submitError && (
                    <p role="alert" className="text-sm font-medium" style={{ color: 'var(--accent-vermilion)' }}>
                      {submitError}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="touch-target px-6 py-2.5 rounded font-semibold text-sm cursor-pointer disabled:opacity-50"
                      style={{
                        backgroundColor: 'var(--accent-vermilion)',
                        color: '#ffffff',
                      }}
                    >
                      {submitting
                        ? locale === 'ko'
                          ? '처리 중...'
                          : 'Processing...'
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
              )}

              {/* 스튜디오 관리 목록 */}
              <div
                className="border rounded overflow-hidden"
                style={{
                  borderColor: 'var(--border-hairline)',
                  backgroundColor: 'var(--bg-card)',
                }}
              >
                <div
                  className="px-5 py-3 border-b flex items-center justify-between"
                  style={{
                    borderColor: 'var(--border-hairline)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <h3 className="text-sm font-bold">
                    {locale === 'ko'
                      ? '스튜디오 원고 및 리비전 관리 목록'
                      : 'Studio Manuscript & Revision Queue'}
                  </h3>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                    {studioEpisodes.length} {locale === 'ko' ? '개 작품' : 'episodes'}
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-hairline)' }}>
                  {studioEpisodes.map((ep) => (
                    <div
                      key={ep.episodeId}
                      className="px-5 py-4 flex flex-wrap items-center justify-between gap-4"
                    >
                      <div>
                        <div className="font-bold text-sm">
                          {locale === 'ko' ? ep.titleKo : ep.titleEn}
                        </div>
                        <div className="text-xs mt-0.5 tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                          ID: {ep.episodeId} · 상태: {ep.status} · 원고 {ep.sourceImageCount}장 · 분석된 컷{' '}
                          {ep.panelCount}개 · 활성 초안: {ep.activeDraftRevisionId}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/studio/${ep.episodeId}`}
                          className="touch-target inline-flex items-center px-4 py-2 rounded text-xs font-semibold border no-underline"
                          style={{
                            borderColor: 'var(--border-strong)',
                            color: 'var(--ink-primary)',
                          }}
                        >
                          {locale === 'ko' ? '접근성 커스텀 스튜디오' : 'Open Studio'}
                        </Link>
                        {ep.publishedRevisionId && (
                          <Link
                            href={`/read/${ep.episodeId}`}
                            className="touch-target inline-flex items-center px-4 py-2 rounded text-xs font-semibold no-underline"
                            style={{
                              backgroundColor: 'var(--accent-vermilion)',
                              color: '#ffffff',
                            }}
                          >
                            {locale === 'ko' ? '독자 리더 열기' : 'Open Reader'}
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer
        className="border-t py-6 mt-12 text-xs"
        style={{
          borderColor: 'var(--border-hairline)',
          color: 'var(--ink-muted)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-wrap justify-between gap-4">
          <span>PanelCast — Accessible Webtoon Publishing & Audio Reader</span>
          <span>Powered by Gemini Multimodal & Multi-Voice TTS on Google Cloud Run</span>
        </div>
      </footer>
    </div>
  );
}
