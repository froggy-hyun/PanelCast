import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import type {
  AudioAsset,
  Episode,
  EpisodeTask,
  LocaleCode,
  ManifestPanelEntry,
  PlaybackManifest,
  Revision,
} from './types';

const LOCAL_STORAGE_ROOT =
  process.env.PANELCAST_LOCAL_STORAGE_DIR || path.join(process.cwd(), '.local-storage');
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'h2gdm-hack26icn-2669';
const GCS_PRIVATE_BUCKET =
  process.env.GCS_PRIVATE_BUCKET || 'h2gdm-hack26icn-2669-panelcast-private';

function shouldSyncCloud(): boolean {
  return process.env.ENABLE_CLOUD_STORAGE_SYNC === 'true';
}

let firestoreInstance: Firestore | null = null;
let storageInstance: Storage | null = null;

function getFirestoreClient(): Firestore | null {
  if (!shouldSyncCloud()) return null;
  if (!firestoreInstance) {
    firestoreInstance = new Firestore({
      projectId: GCP_PROJECT_ID,
      ignoreUndefinedProperties: true,
    });
  }
  return firestoreInstance;
}

function getStorageClient(): Storage | null {
  if (!shouldSyncCloud()) return null;
  if (!storageInstance) {
    storageInstance = new Storage({ projectId: GCP_PROJECT_ID });
  }
  return storageInstance;
}

async function writeLocalJson(relPath: string, data: unknown): Promise<void> {
  const fullPath = path.join(/*turbopackIgnore: true*/ LOCAL_STORAGE_ROOT, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const tmpPath = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, fullPath);
}

async function readLocalJson<T>(relPath: string): Promise<T | null> {
  const fullPath = path.join(/*turbopackIgnore: true*/ LOCAL_STORAGE_ROOT, relPath);
  try {
    const raw = await fs.readFile(/*turbopackIgnore: true*/ fullPath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// 비공개 바이너리 에셋 저장 (로컬 캐시 + Private GCS 동기화)
export async function storeBinaryAsset(
  relativeKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const cleanKey = relativeKey.replace(/^\/+/, '');
  const localFile = path.join(/*turbopackIgnore: true*/ LOCAL_STORAGE_ROOT, 'blobs', cleanKey);
  await fs.mkdir(path.dirname(localFile), { recursive: true });
  await fs.writeFile(localFile, buffer);

  const gcs = getStorageClient();
  if (gcs) {
    try {
      const bucket = gcs.bucket(GCS_PRIVATE_BUCKET);
      const file = bucket.file(cleanKey);
      await file.save(buffer, {
        resumable: false,
        contentType: mimeType,
        metadata: {
          cacheControl: 'private, max-age=3600',
        },
      });
      return `gs://${GCS_PRIVATE_BUCKET}/${cleanKey}`;
    } catch {
      // 로컬 스토리지 URI 폴백
    }
  }

  return `local://${cleanKey}`;
}

// 비공개 바이너리 에셋 읽기 (로컬 캐시 우선, 없으면 Private GCS에서 로드 후 캐시)
export async function readBinaryAsset(storageUri: string): Promise<Buffer> {
  let cleanKey = storageUri;
  if (storageUri.startsWith('local://')) {
    cleanKey = storageUri.slice('local://'.length);
  } else if (storageUri.startsWith('gs://')) {
    const withoutScheme = storageUri.slice('gs://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    cleanKey = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : withoutScheme;
  }
  cleanKey = cleanKey.replace(/^\/+/, '');

  const localFile = path.join(/*turbopackIgnore: true*/ LOCAL_STORAGE_ROOT, 'blobs', cleanKey);
  try {
    return await fs.readFile(/*turbopackIgnore: true*/ localFile);
  } catch {
    const gcs = getStorageClient();
    if (gcs) {
      const bucket = gcs.bucket(GCS_PRIVATE_BUCKET);
      const [downloaded] = await bucket.file(cleanKey).download();
      await fs.mkdir(path.dirname(localFile), { recursive: true });
      await fs.writeFile(localFile, downloaded);
      return downloaded;
    }
    throw new Error(`Binary asset not found: ${storageUri}`);
  }
}

async function writeCloudJsonObject(objectKey: string, data: unknown): Promise<void> {
  const gcs = getStorageClient();
  if (!gcs) return;
  try {
    const bucket = gcs.bucket(GCS_PRIVATE_BUCKET);
    await bucket.file(objectKey).save(Buffer.from(JSON.stringify(data), 'utf8'), {
      resumable: false,
      contentType: 'application/json',
    });
  } catch {
    // 로컬 파일에 이미 저장됨
  }
}

async function readCloudJsonObject<T>(objectKey: string): Promise<T | null> {
  const gcs = getStorageClient();
  if (!gcs) return null;
  try {
    const bucket = gcs.bucket(GCS_PRIVATE_BUCKET);
    const [buf] = await bucket.file(objectKey).download();
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export async function saveEpisode(episode: Episode): Promise<void> {
  await writeLocalJson(`episodes/${episode.episodeId}/episode.json`, episode);

  const db = getFirestoreClient();
  if (db) {
    try {
      await db.collection('episodes').doc(episode.episodeId).set(episode, { merge: true });
    } catch {
      // 로컬 저장 완료
    }
  }
  await writeCloudJsonObject(`metadata/episodes/${episode.episodeId}/episode.json`, episode);
}

export async function getEpisode(episodeId: string): Promise<Episode | null> {
  const local = await readLocalJson<Episode>(`episodes/${episodeId}/episode.json`);
  if (local) return local;

  const db = getFirestoreClient();
  if (db) {
    try {
      const snap = await db.collection('episodes').doc(episodeId).get();
      if (snap.exists) {
        const ep = snap.data() as Episode;
        await writeLocalJson(`episodes/${episodeId}/episode.json`, ep);
        return ep;
      }
    } catch {
      // GCS 폴백 시도
    }
  }

  const fromGcs = await readCloudJsonObject<Episode>(
    `metadata/episodes/${episodeId}/episode.json`,
  );
  if (fromGcs) {
    await writeLocalJson(`episodes/${episodeId}/episode.json`, fromGcs);
    return fromGcs;
  }

  return null;
}

export async function listEpisodes(): Promise<Episode[]> {
  const episodesMap = new Map<string, Episode>();

  const episodesDir = path.join(/*turbopackIgnore: true*/ LOCAL_STORAGE_ROOT, 'episodes');
  try {
    const entries = await fs.readdir(/*turbopackIgnore: true*/ episodesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const ep = await readLocalJson<Episode>(`episodes/${entry.name}/episode.json`);
        if (ep) {
          episodesMap.set(ep.episodeId, ep);
        }
      }
    }
  } catch {
    // 디렉토리 없음
  }

  const db = getFirestoreClient();
  if (db && episodesMap.size === 0) {
    try {
      const snap = await db.collection('episodes').get();
      for (const doc of snap.docs) {
        const ep = doc.data() as Episode;
        episodesMap.set(ep.episodeId, ep);
        await writeLocalJson(`episodes/${ep.episodeId}/episode.json`, ep);
      }
    } catch {
      // 로컬 목록 반환
    }
  }

  return Array.from(episodesMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function saveRevision(
  revision: Revision,
  options?: { localOnly?: boolean },
): Promise<void> {
  await writeLocalJson(
    `episodes/${revision.episodeId}/revisions/${revision.revisionId}.json`,
    revision,
  );
  if (options?.localOnly) {
    return;
  }

  // 대용량 리비전 JSON은 Private GCS에 원본 저장하고 Firestore에는 요약 메타데이터 저장
  await writeCloudJsonObject(
    `metadata/episodes/${revision.episodeId}/revisions/${revision.revisionId}.json`,
    revision,
  );

  const db = getFirestoreClient();
  if (db) {
    try {
      await db
        .collection('episodes')
        .doc(revision.episodeId)
        .collection('revisions')
        .doc(revision.revisionId)
        .set(
          {
            revisionId: revision.revisionId,
            episodeId: revision.episodeId,
            revisionNumber: revision.revisionNumber,
            status: revision.status,
            publishMode: revision.publishMode,
            panelCount: revision.panels.length,
            segmentCount: revision.segments.length,
            characterCount: revision.characters.length,
            audioAssetCount: revision.audioAssets.length,
            voicePoolExhausted: revision.voicePoolExhausted,
            autoCorrectionApplied: revision.autoCorrectionApplied,
            createdAt: revision.createdAt,
            updatedAt: revision.updatedAt,
          },
          { merge: true },
        );
    } catch {
      // 로컬 및 GCS 저장 완료
    }
  }
}

export async function getRevision(
  episodeId: string,
  revisionId: string,
): Promise<Revision | null> {
  const local = await readLocalJson<Revision>(
    `episodes/${episodeId}/revisions/${revisionId}.json`,
  );
  if (local) return local;

  const fromGcs = await readCloudJsonObject<Revision>(
    `metadata/episodes/${episodeId}/revisions/${revisionId}.json`,
  );
  if (fromGcs) {
    await writeLocalJson(`episodes/${episodeId}/revisions/${revisionId}.json`, fromGcs);
    return fromGcs;
  }

  return null;
}

export async function saveManifest(manifest: PlaybackManifest): Promise<void> {
  const relPath = `episodes/${manifest.episodeId}/manifests/${manifest.revisionId}_${manifest.locale}.json`;
  await writeLocalJson(relPath, manifest);
  await writeCloudJsonObject(`metadata/${relPath}`, manifest);
}

export async function getManifest(
  episodeId: string,
  revisionId: string,
  locale: LocaleCode,
): Promise<PlaybackManifest | null> {
  const relPath = `episodes/${episodeId}/manifests/${revisionId}_${locale}.json`;
  const local = await readLocalJson<PlaybackManifest>(relPath);
  if (local) return local;

  const fromGcs = await readCloudJsonObject<PlaybackManifest>(`metadata/${relPath}`);
  if (fromGcs) {
    await writeLocalJson(relPath, fromGcs);
    return fromGcs;
  }

  const rev = await getRevision(episodeId, revisionId);
  if (rev?.manifests?.[locale]) {
    await writeLocalJson(relPath, rev.manifests[locale]!);
    return rev.manifests[locale]!;
  }

  return null;
}

// 커서 기반 매니페스트 페이지네이션 (긴 에피소드도 안정적으로 분할 전송 T18)
export function getPaginatedManifestSlice(params: {
  manifest: PlaybackManifest;
  cursor?: string;
  limit?: number;
}): {
  revisionId: string;
  locale: LocaleCode;
  panels: ManifestPanelEntry[];
  totalPanels: number;
  totalSegments: number;
  totalDurationMs: number;
  nextCursor?: string;
  hasMore: boolean;
} {
  const { manifest, cursor, limit = 20 } = params;
  const startIndex = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const slice = manifest.panels.slice(startIndex, startIndex + safeLimit);
  const nextIndex = startIndex + slice.length;
  const hasMore = nextIndex < manifest.panels.length;

  return {
    revisionId: manifest.revisionId,
    locale: manifest.locale,
    panels: slice,
    totalPanels: manifest.totalPanels,
    totalSegments: manifest.totalSegments,
    totalDurationMs: manifest.totalDurationMs,
    nextCursor: hasMore ? String(nextIndex) : undefined,
    hasMore,
  };
}

export async function saveEpisodeTask(task: EpisodeTask): Promise<void> {
  const relPath = `episodes/${task.episodeId}/tasks/${task.revisionId}/${task.taskId}.json`;
  await writeLocalJson(relPath, task);
}

export async function getEpisodeTasks(
  episodeId: string,
  revisionId: string,
): Promise<EpisodeTask[]> {
  const dir = path.join(/*turbopackIgnore: true*/ LOCAL_STORAGE_ROOT, 'episodes', episodeId, 'tasks', revisionId);
  try {
    const files = await fs.readdir(/*turbopackIgnore: true*/ dir);
    const tasks: EpisodeTask[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const task = await readLocalJson<EpisodeTask>(
        `episodes/${episodeId}/tasks/${revisionId}/${file}`,
      );
      if (task) tasks.push(task);
    }
    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

// Stale 작업 덮어쓰기 방지 가드: 세그먼트의 현재 inputHash와 일치할 때만 오디오 슬롯 갱신 (T17)
export async function recordAudioAssetWithInputHashGuard(params: {
  episodeId: string;
  revisionId: string;
  segmentId: string;
  locale: LocaleCode;
  expectedInputHash: string;
  asset: AudioAsset;
  localOnly?: boolean;
}): Promise<{ applied: boolean; reason?: string }> {
  const revision = await getRevision(params.episodeId, params.revisionId);
  if (!revision) {
    return { applied: false, reason: 'Revision not found' };
  }

  const targetSegment = revision.segments.find((s) => s.segmentId === params.segmentId);
  if (!targetSegment) {
    return { applied: false, reason: 'Segment not found' };
  }

  const currentHash = targetSegment.inputHashByLocale[params.locale];
  if (currentHash && currentHash !== params.expectedInputHash) {
    return {
      applied: false,
      reason: `Stale task output rejected: expected hash ${params.expectedInputHash}, but current segment hash is ${currentHash}`,
    };
  }

  const existingIdx = revision.audioAssets.findIndex(
    (a) => a.audioAssetId === params.asset.audioAssetId,
  );
  if (existingIdx >= 0) {
    revision.audioAssets[existingIdx] = params.asset;
  } else {
    revision.audioAssets.push(params.asset);
  }

  targetSegment.inputHashByLocale[params.locale] = params.expectedInputHash;
  targetSegment.audioAssetIdByLocale[params.locale] = params.asset.audioAssetId;
  revision.updatedAt = new Date().toISOString();
  await saveRevision(revision, { localOnly: params.localOnly });

  return { applied: true };
}

// 원자적 리비전 게시: 검증 통과한 리비전을 published로 전환하고 Episode.publishedRevisionId 교체 (T05, T08)
export async function publishRevisionAtomically(params: {
  episodeId: string;
  revisionId: string;
}): Promise<{ episode: Episode; revision: Revision }> {
  const episode = await getEpisode(params.episodeId);
  const revision = await getRevision(params.episodeId, params.revisionId);
  if (!episode || !revision) {
    throw new Error(`Cannot publish: episode or revision not found (${params.episodeId}/${params.revisionId})`);
  }

  const now = new Date().toISOString();
  revision.status = 'published';
  revision.updatedAt = now;

  episode.publishedRevisionId = revision.revisionId;
  episode.status = 'published';
  episode.panelCount = revision.panels.length;
  episode.characterCount = revision.characters.length;
  episode.voicePoolExhausted = revision.voicePoolExhausted;
  episode.updatedAt = now;

  await saveRevision(revision);
  await saveEpisode(episode);

  return { episode, revision };
}

// 공개 중인 리비전에 영향을 주지 않고 새로운 편집 가능한 Draft 리비전 복제 생성 (T08)
export async function cloneRevisionAsEditableDraft(
  episodeId: string,
  sourceRevisionId: string,
): Promise<Revision> {
  const episode = await getEpisode(episodeId);
  const sourceRev = await getRevision(episodeId, sourceRevisionId);
  if (!episode || !sourceRev) {
    throw new Error(`Source revision not found: ${episodeId}/${sourceRevisionId}`);
  }

  const now = new Date().toISOString();
  const nextNumber = sourceRev.revisionNumber + 1;
  const newRevisionId = `rev_${episodeId}_v${nextNumber}_${Date.now().toString(36).slice(-4)}`;

  const cloned: Revision = {
    ...structuredClone(sourceRev),
    revisionId: newRevisionId,
    revisionNumber: nextNumber,
    status: 'ready',
    publishMode: 'custom',
    manifests: {},
    createdAt: now,
    updatedAt: now,
  };

  for (const panel of cloned.panels) {
    panel.revisionId = newRevisionId;
  }
  for (const seg of cloned.segments) {
    seg.revisionId = newRevisionId;
  }
  for (const char of cloned.characters) {
    char.revisionId = newRevisionId;
  }
  for (const cue of cloned.soundCues) {
    cue.revisionId = newRevisionId;
  }

  episode.activeDraftRevisionId = newRevisionId;
  episode.updatedAt = now;

  await saveRevision(cloned);
  await saveEpisode(episode);

  return cloned;
}
