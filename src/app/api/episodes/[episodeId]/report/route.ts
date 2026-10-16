import { NextRequest, NextResponse } from 'next/server';
import { getEpisode } from '@/lib/store';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await context.params;
  const episode = await getEpisode(episodeId);
  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  try {
    const body = (await req.json()) as {
      panelId?: string;
      segmentId?: string;
      category?: string;
      message?: string;
    };
    const report = {
      reportId: `rep_${Date.now().toString(36)}`,
      episodeId,
      panelId: body.panelId ?? null,
      segmentId: body.segmentId ?? null,
      category: body.category ?? 'accessibility_feedback',
      message: (body.message ?? '').slice(0, 1000),
      createdAt: new Date().toISOString(),
    };

    const dir = path.join(process.cwd(), '.local-storage', 'reports');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${report.reportId}.json`),
      JSON.stringify(report, null, 2),
      'utf8',
    );

    return NextResponse.json({ ok: true, reportId: report.reportId });
  } catch {
    return NextResponse.json({ error: 'Invalid report payload' }, { status: 400 });
  }
}
