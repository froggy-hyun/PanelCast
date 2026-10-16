import { NextRequest, NextResponse } from 'next/server';
import { verifyPublisherRequest } from '@/lib/auth';
import {
  analyzeEpisodeRevisionTiles,
  synthesizeRevisionAudio,
  validateAndFinalizeRevision,
} from '@/lib/pipeline';
import { getEpisode, getEpisodeTasks, getRevision, saveEpisodeTask } from '@/lib/store';
import { reconcilePendingAndExpiredTasks } from '@/lib/tasks';
import type { LocaleCode } from '@/lib/types';

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

  const body = (await req.json()) as {
    revisionId?: string;
    action:
      | 'analyze'
      | 'synthesize'
      | 'validate'
      | 'auto_publish'
      | 'reconcile_tasks'
      | 'cancel';
    locales?: LocaleCode[];
    onlySegmentIds?: string[];
    maxTilesToAnalyze?: number;
  };

  const revisionId = body.revisionId || episode.activeDraftRevisionId;
  const revision = await getRevision(episodeId, revisionId);
  if (!revision) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  }

  try {
    if (body.action === 'reconcile_tasks') {
      const outcome = await reconcilePendingAndExpiredTasks(episodeId, revisionId);
      return NextResponse.json(outcome);
    }

    if (body.action === 'cancel') {
      const tasks = await getEpisodeTasks(episodeId, revisionId);
      let cancelledCount = 0;
      for (const task of tasks) {
        if (
          task.status === 'pending_dispatch' ||
          task.status === 'queued' ||
          task.status === 'running'
        ) {
          task.status = 'cancelled';
          task.updatedAt = new Date().toISOString();
          await saveEpisodeTask(task);
          cancelledCount += 1;
        }
      }
      return NextResponse.json({ cancelledCount });
    }

    if (body.action === 'analyze') {
      const analyzed = await analyzeEpisodeRevisionTiles({
        episodeId,
        revisionId,
        maxTilesToAnalyze: body.maxTilesToAnalyze,
      });
      return NextResponse.json(analyzed);
    }

    if (body.action === 'synthesize') {
      const synth = await synthesizeRevisionAudio({
        episodeId,
        revisionId,
        locales: body.locales,
        onlySegmentIds: body.onlySegmentIds,
      });
      const validated = await validateAndFinalizeRevision({
        episodeId,
        revisionId,
        autoPublishIfValid: false,
      });
      return NextResponse.json({
        episode: validated.episode,
        revision: validated.revision,
        synthesizedCount: synth.synthesizedCount,
        reusedCount: synth.reusedCount,
        validationReport: validated.finalReport,
      });
    }

    if (body.action === 'validate') {
      const validated = await validateAndFinalizeRevision({
        episodeId,
        revisionId,
        autoPublishIfValid: false,
      });
      return NextResponse.json(validated);
    }

    if (body.action === 'auto_publish') {
      if (revision.panels.length === 0) {
        await analyzeEpisodeRevisionTiles({
          episodeId,
          revisionId,
          maxTilesToAnalyze: body.maxTilesToAnalyze,
        });
      }
      const synth = await synthesizeRevisionAudio({
        episodeId,
        revisionId,
        locales: body.locales,
      });
      const finalized = await validateAndFinalizeRevision({
        episodeId,
        revisionId,
        autoPublishIfValid: true,
      });
      return NextResponse.json({
        ...finalized,
        synthesizedCount: synth.synthesizedCount,
        reusedCount: synth.reusedCount,
      });
    }

    return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
