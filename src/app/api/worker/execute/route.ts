import { NextRequest, NextResponse } from 'next/server';
import { verifyPrivateWorkerRequest } from '@/lib/auth';
import {
  analyzeEpisodeRevisionTiles,
  synthesizeRevisionAudio,
  validateAndFinalizeRevision,
} from '@/lib/pipeline';
import { reconcilePendingAndExpiredTasks } from '@/lib/tasks';

export async function POST(req: NextRequest) {
  // X-CloudTasks-* 헤더만 위조한 요청은 거부하고 유효한 OIDC/Worker 토큰만 허용 (T16)
  const auth = await verifyPrivateWorkerRequest(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as {
      episodeId: string;
      revisionId: string;
      action?: 'reconcile' | 'analyze' | 'synthesize' | 'validate';
      segmentIds?: string[];
    };

    if (!body.episodeId || !body.revisionId) {
      return NextResponse.json(
        { error: 'episodeId and revisionId are required.' },
        { status: 400 },
      );
    }

    if (body.action === 'reconcile') {
      const rec = await reconcilePendingAndExpiredTasks(body.episodeId, body.revisionId);
      return NextResponse.json({ ok: true, ...rec });
    }

    if (body.action === 'analyze') {
      const res = await analyzeEpisodeRevisionTiles({
        episodeId: body.episodeId,
        revisionId: body.revisionId,
      });
      return NextResponse.json({ ok: true, status: res.revision.status });
    }

    if (body.action === 'synthesize') {
      const res = await synthesizeRevisionAudio({
        episodeId: body.episodeId,
        revisionId: body.revisionId,
        onlySegmentIds: body.segmentIds,
      });
      return NextResponse.json({
        ok: true,
        synthesizedCount: res.synthesizedCount,
        reusedCount: res.reusedCount,
      });
    }

    if (body.action === 'validate') {
      const res = await validateAndFinalizeRevision({
        episodeId: body.episodeId,
        revisionId: body.revisionId,
      });
      return NextResponse.json({
        ok: true,
        valid: res.finalReport.valid,
        published: res.published,
      });
    }

    const rec = await reconcilePendingAndExpiredTasks(body.episodeId, body.revisionId);
    return NextResponse.json({ ok: true, ...rec });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
