import fs from 'node:fs/promises';
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {
  // .env optional
}
try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch {
  // .env.local optional
}

import {
  createEpisodeWithManuscript,
  analyzeEpisodeRevisionTiles,
  synthesizeRevisionAudio,
  validateAndFinalizeRevision,
  type UploadedManuscriptFile,
} from '../src/lib/pipeline';
import { getEpisode, getRevision } from '../src/lib/store';

const MANUSCRIPT_DIR = '/Users/1233day/Downloads/나 혼자 만렙 뉴비/02화. 서막';
const DEMO_EPISODE_ID = 'ep_solo_max_newbie_02';
const DEMO_REVISION_ID = 'rev_ep_solo_max_newbie_02_v1';

async function main() {
  let episode = await getEpisode(DEMO_EPISODE_ID);
  let revision = await getRevision(DEMO_EPISODE_ID, DEMO_REVISION_ID);

  if (!episode || !revision || revision.sourceImages.length < 60 || revision.tiles.length < 16) {
    console.log(`[1/4] Reading manuscript files from: ${MANUSCRIPT_DIR}`);
    const entries = await fs.readdir(MANUSCRIPT_DIR);
    const jpgFiles = entries
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    console.log(`Found ${jpgFiles.length} strip images (${jpgFiles[0]} .. ${jpgFiles[jpgFiles.length - 1]})`);

    const files: UploadedManuscriptFile[] = [];
    for (const filename of jpgFiles) {
      const buffer = await fs.readFile(path.join(MANUSCRIPT_DIR, filename));
      files.push({ filename, buffer });
    }

    console.log(`[2/4] Ingesting 60-cut manuscript and building overlapping tiles...`);
    const created = await createEpisodeWithManuscript({
      episodeId: DEMO_EPISODE_ID,
      titleKo: '나 혼자 만렙 뉴비 — 02화. 서막',
      titleEn: 'Solo Max-Level Newbie — Ep. 02: Prologue',
      summaryKo:
        '게임 [시련의 탑]이 현실이 된 날, 유일하게 모든 공략을 꿰뚫고 있는 고인물 강진혁이 생존과 정복의 서막을 여는 배리어프리 오디오 웹툰 에피소드.',
      summaryEn:
        'When the game [Tower of Trials] becomes reality, Kang Jinhyuk—the only player who knows every hidden strategy—begins his ascent in this barrier-free audio webtoon episode.',
      authorName: '메슬로우 · 스윙배트 (WAN.Z)',
      publishMode: 'auto_publish',
      files,
    });
    episode = created.episode;
    revision = created.revision;
  } else {
    const uniqueCharIds = new Set(revision.characters.map((c) => c.characterId));
    if (uniqueCharIds.size !== revision.characters.length) {
      revision.characters = [];
      const { saveRevision } = await import('../src/lib/store');
      await saveRevision(revision, { localOnly: true });
      console.log(`Reset duplicate characterIds for clean cast reconciliation.`);
    }
    console.log(
      `[1-2/4] Reusing already ingested 60 strips and ${revision.tiles.length} overlapping tiles for ${episode.episodeId}`,
    );
  }

  console.log(
    `Ready episode=${episode.episodeId}, revision=${revision.revisionId}, strips=${revision.sourceImages.length}, totalHeight=${episode.totalStitchedHeight}px, tiles=${revision.tiles.length}`,
  );

  console.log(`[3/4] Analyzing ${revision.tiles.length} overlapping tiles with Gemini 4 Argon...`);
  const analyzed = await analyzeEpisodeRevisionTiles({
    episodeId: episode.episodeId,
    revisionId: revision.revisionId,
  });

  console.log(
    `Analysis complete: panels=${analyzed.revision.panels.length}, segments=${analyzed.revision.segments.length}, characters=${analyzed.revision.characters.length}, soundCues=${analyzed.revision.soundCues.length}`,
  );

  console.log(`[4/4] Synthesizing Korean & English multi-voice TTS + SFX and running validation gate...`);
  const synthOutcome = await synthesizeRevisionAudio({
    episodeId: episode.episodeId,
    revisionId: revision.revisionId,
    locales: ['ko', 'en'],
  });

  console.log(
    `Audio synthesis complete: synthesized=${synthOutcome.synthesizedCount}, reused=${synthOutcome.reusedCount}`,
  );

  const finalized = await validateAndFinalizeRevision({
    episodeId: episode.episodeId,
    revisionId: revision.revisionId,
    autoPublishIfValid: true,
  });

  console.log(
    `Finalized episode=${finalized.episode.episodeId} status=${finalized.episode.status} published=${finalized.published} valid=${finalized.finalReport.valid} issues=${finalized.finalReport.issues.length}`,
  );
  if (!finalized.finalReport.valid) {
    console.error('Validation issues:', JSON.stringify(finalized.finalReport.issues, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during manuscript ingestion:', err);
  process.exit(1);
});
