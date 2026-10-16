import { NextRequest, NextResponse } from 'next/server';
import { listEpisodes } from '@/lib/store';
import { verifyPublisherRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const includeDrafts = req.nextUrl.searchParams.get('includeDrafts') === 'true';
  const allEpisodes = await listEpisodes();

  if (includeDrafts) {
    const auth = verifyPublisherRequest(req);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.reason }, { status: auth.status });
    }
    return NextResponse.json({ episodes: allEpisodes });
  }

  // 일반 독자에게는 게시 완료된(publishedRevisionId 존재) 작품만 노출
  const publishedEpisodes = allEpisodes.filter((ep) => Boolean(ep.publishedRevisionId));
  return NextResponse.json({ episodes: publishedEpisodes });
}
