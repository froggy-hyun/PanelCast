import { NextRequest, NextResponse } from 'next/server';
import {
  getEpisode,
  getManifest,
  getPaginatedManifestSlice,
  getRevision,
} from '@/lib/store';
import { verifyPublisherRequest } from '@/lib/auth';
import type { LocaleCode } from '@/lib/types';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await context.params;
  const episode = await getEpisode(episodeId);
  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  const localeParam = req.nextUrl.searchParams.get('locale');
  const locale: LocaleCode = localeParam === 'en' ? 'en' : 'ko';
  const requestedRevisionId = req.nextUrl.searchParams.get('revisionId');
  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

  let targetRevisionId = episode.publishedRevisionId;

  if (requestedRevisionId) {
    const requestedRevision = await getRevision(episodeId, requestedRevisionId);
    if (!requestedRevision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }
    const isPublishedOrHistorical =
      requestedRevision.status === 'published' ||
      requestedRevisionId === episode.publishedRevisionId;

    if (!isPublishedOrHistorical) {
      const auth = verifyPublisherRequest(req);
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Unpublished draft revision requires publisher authentication.' },
          { status: 403 },
        );
      }
    }
    targetRevisionId = requestedRevisionId;
  }

  if (!targetRevisionId) {
    return NextResponse.json(
      { error: 'This episode has no published revision yet.' },
      { status: 404 },
    );
  }

  const manifest = await getManifest(episodeId, targetRevisionId, locale);
  if (!manifest) {
    return NextResponse.json(
      { error: `Manifest not found for ${episodeId}/${targetRevisionId}/${locale}` },
      { status: 404 },
    );
  }

  const slice = getPaginatedManifestSlice({
    manifest,
    cursor,
    limit,
  });

  return NextResponse.json({
    episode: {
      episodeId: episode.episodeId,
      titleKo: episode.titleKo,
      titleEn: episode.titleEn,
      summaryKo: episode.summaryKo,
      summaryEn: episode.summaryEn,
      authorName: episode.authorName,
      publishedRevisionId: episode.publishedRevisionId,
    },
    ...slice,
  });
}
