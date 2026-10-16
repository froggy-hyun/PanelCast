import { NextRequest, NextResponse } from 'next/server';
import { verifyPublisherRequest } from '@/lib/auth';
import { getEpisode, getRevision, publishRevisionAtomically } from '@/lib/store';
import { validateAndFinalizeRevision } from '@/lib/pipeline';

export async function POST(
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

  try {
    const body = (await req.json().catch(() => ({}))) as { revisionId?: string };
    const revisionId = body.revisionId || episode.activeDraftRevisionId;
    const revision = await getRevision(episodeId, revisionId);
    if (!revision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }

    // 게시 전 검증 및 매니페스트 최신화
    const validated = await validateAndFinalizeRevision({
      episodeId,
      revisionId,
      autoPublishIfValid: false,
    });

    if (!validated.finalReport.valid) {
      return NextResponse.json(
        {
          error: 'Revision failed validation and cannot be published.',
          validationReport: validated.finalReport,
        },
        { status: 422 },
      );
    }

    const published = await publishRevisionAtomically({
      episodeId,
      revisionId,
    });

    return NextResponse.json({
      episode: published.episode,
      revision: published.revision,
      validationReport: validated.finalReport,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
