import { NextRequest, NextResponse } from 'next/server';
import { verifyPublisherRequest } from '@/lib/auth';
import {
  analyzeEpisodeRevisionTiles,
  createEpisodeWithManuscript,
  synthesizeRevisionAudio,
  UploadedManuscriptFile,
  validateAndFinalizeRevision,
} from '@/lib/pipeline';
import type { PublishMode } from '@/lib/types';

export async function POST(req: NextRequest) {
  const auth = verifyPublisherRequest(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let titleKo = '제목 없는 에피소드';
    let titleEn = 'Untitled Episode';
    let summaryKo = '';
    let summaryEn = '';
    let authorName = 'PanelCast Studio';
    let publishMode: PublishMode = 'custom';
    let runImmediately = false;
    const files: UploadedManuscriptFile[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      titleKo = String(formData.get('titleKo') || titleKo).trim();
      titleEn = String(formData.get('titleEn') || titleEn).trim();
      summaryKo = String(formData.get('summaryKo') || '').trim();
      summaryEn = String(formData.get('summaryEn') || '').trim();
      authorName = String(formData.get('authorName') || authorName).trim();
      const modeVal = String(formData.get('publishMode') || 'custom');
      publishMode = modeVal === 'auto_publish' ? 'auto_publish' : 'custom';
      runImmediately = String(formData.get('runImmediately') || 'false') === 'true';

      const uploadedEntries = formData.getAll('files');
      for (const entry of uploadedEntries) {
        if (entry instanceof File) {
          const arrayBuffer = await entry.arrayBuffer();
          files.push({
            filename: entry.name,
            buffer: Buffer.from(arrayBuffer),
          });
        }
      }
    } else {
      const body = (await req.json()) as {
        titleKo?: string;
        titleEn?: string;
        summaryKo?: string;
        summaryEn?: string;
        authorName?: string;
        publishMode?: PublishMode;
        runImmediately?: boolean;
        files?: Array<{ filename: string; base64: string }>;
      };
      titleKo = (body.titleKo || titleKo).trim();
      titleEn = (body.titleEn || titleEn).trim();
      summaryKo = (body.summaryKo || '').trim();
      summaryEn = (body.summaryEn || '').trim();
      authorName = (body.authorName || authorName).trim();
      publishMode = body.publishMode === 'auto_publish' ? 'auto_publish' : 'custom';
      runImmediately = Boolean(body.runImmediately);

      for (const f of body.files ?? []) {
        files.push({
          filename: f.filename,
          buffer: Buffer.from(f.base64, 'base64'),
        });
      }
    }

    const created = await createEpisodeWithManuscript({
      titleKo,
      titleEn,
      summaryKo,
      summaryEn,
      authorName,
      publishMode,
      files,
    });

    if (runImmediately) {
      await analyzeEpisodeRevisionTiles({
        episodeId: created.episode.episodeId,
        revisionId: created.revision.revisionId,
      });
      await synthesizeRevisionAudio({
        episodeId: created.episode.episodeId,
        revisionId: created.revision.revisionId,
      });
      const finalized = await validateAndFinalizeRevision({
        episodeId: created.episode.episodeId,
        revisionId: created.revision.revisionId,
        autoPublishIfValid: publishMode === 'auto_publish',
      });
      return NextResponse.json({
        episode: finalized.episode,
        revision: finalized.revision,
        validationReport: finalized.finalReport,
        published: finalized.published,
      });
    }

    return NextResponse.json(
      {
        episode: created.episode,
        revision: created.revision,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Invalid image signature') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
