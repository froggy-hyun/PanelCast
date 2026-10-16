import crypto from 'node:crypto';
import type { EpisodeTask, TaskStatus, TaskType } from './types';
import { getEpisodeTasks, saveEpisodeTask } from './store';

const LEASE_DURATION_MS = 180_000;

export function buildDeterministicTaskId(parts: Array<string | number>): string {
  const hash = crypto
    .createHash('sha256')
    .update(parts.map((p) => String(p)).join('|'))
    .digest('hex')
    .slice(0, 24);
  return `task_${parts[0]}_${hash}`;
}

// 멱등성 보장 작업 생성: 먼저 pending_dispatch 상태로 저장 후 큐 디스패치 시도
export async function enqueueIdempotentTask(params: {
  episodeId: string;
  revisionId: string;
  taskType: TaskType;
  idempotencyKeyParts: Array<string | number>;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<{ task: EpisodeTask; created: boolean }> {
  const taskId = buildDeterministicTaskId([
    params.taskType,
    params.episodeId,
    params.revisionId,
    ...params.idempotencyKeyParts,
  ]);
  const existing = await getEpisodeTasks(params.episodeId, params.revisionId);
  const found = existing.find((t) => t.taskId === taskId);
  const now = new Date().toISOString();

  if (found && (found.status === 'succeeded' || found.status === 'running' || found.status === 'queued')) {
    return { task: found, created: false };
  }

  const task: EpisodeTask = {
    taskId,
    episodeId: params.episodeId,
    revisionId: params.revisionId,
    taskType: params.taskType,
    status: 'pending_dispatch',
    attemptCount: found ? found.attemptCount : 0,
    maxAttempts: params.maxAttempts ?? 3,
    payload: params.payload,
    createdAt: found?.createdAt ?? now,
    updatedAt: now,
  };

  await saveEpisodeTask(task);
  const dispatched = await dispatchToCloudTasksOrQueued(task);
  return { task: dispatched, created: true };
}

async function dispatchToCloudTasksOrQueued(task: EpisodeTask): Promise<EpisodeTask> {
  const now = new Date().toISOString();
  const workerBaseUrl = process.env.WORKER_SERVICE_URL?.trim();
  const useCloudTasks = process.env.ENABLE_CLOUD_TASKS_DISPATCH === 'true' && Boolean(workerBaseUrl);

  if (useCloudTasks && workerBaseUrl) {
    try {
      const secret = process.env.WORKER_SHARED_SECRET || 'panelcast-worker-dev-secret-2026';
      // 비동기 HTTP 디스패치 (실패 시 maintenance loop이 재시도)
      void fetch(`${workerBaseUrl.replace(/\/$/, '')}/api/worker/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-panelcast-worker-secret': secret,
          'x-cloudtasks-queuename': process.env.CLOUD_TASKS_QUEUE || 'panelcast-episode-queue',
          'x-cloudtasks-taskname': task.taskId,
        },
        body: JSON.stringify({
          episodeId: task.episodeId,
          revisionId: task.revisionId,
          taskId: task.taskId,
        }),
      }).catch(() => {
        // 유지보수 루프가 pending_dispatch 또는 만료된 lease 작업을 재전송함
      });
    } catch {
      // 유지보수 루프에서 복구
    }
  }

  const queuedTask: EpisodeTask = {
    ...task,
    status: 'queued',
    updatedAt: now,
  };
  await saveEpisodeTask(queuedTask);
  return queuedTask;
}

export async function claimTaskLease(
  task: EpisodeTask,
  leaseDurationMs = LEASE_DURATION_MS,
): Promise<EpisodeTask | null> {
  const nowMs = Date.now();
  if (task.status === 'succeeded' || task.status === 'cancelled') {
    return null;
  }
  if (
    task.status === 'running' &&
    task.leaseExpiresAt &&
    new Date(task.leaseExpiresAt).getTime() > nowMs
  ) {
    return null;
  }
  const updated: EpisodeTask = {
    ...task,
    status: 'running',
    attemptCount: task.attemptCount + 1,
    leaseExpiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };
  await saveEpisodeTask(updated);
  return updated;
}

export async function completeTask(
  task: EpisodeTask,
  status: Extract<TaskStatus, 'succeeded' | 'failed' | 'cancelled'>,
  errorMessage?: string,
): Promise<EpisodeTask> {
  const updated: EpisodeTask = {
    ...task,
    status,
    leaseExpiresAt: undefined,
    errorMessage,
    updatedAt: new Date().toISOString(),
  };
  await saveEpisodeTask(updated);
  return updated;
}

// 유지보수 작업: pending_dispatch 상태이거나 lease가 만료된 running 작업을 복구
export async function reconcilePendingAndExpiredTasks(
  episodeId: string,
  revisionId: string,
): Promise<{ recoveredCount: number; tasks: EpisodeTask[] }> {
  const tasks = await getEpisodeTasks(episodeId, revisionId);
  const nowMs = Date.now();
  let recoveredCount = 0;
  const updatedList: EpisodeTask[] = [];

  for (const task of tasks) {
    const isExpiredRunning =
      task.status === 'running' &&
      Boolean(task.leaseExpiresAt) &&
      new Date(task.leaseExpiresAt!).getTime() <= nowMs;

    if (task.status === 'pending_dispatch' || isExpiredRunning) {
      if (task.attemptCount < task.maxAttempts) {
        const requeued: EpisodeTask = {
          ...task,
          status: 'queued',
          leaseExpiresAt: undefined,
          updatedAt: new Date(nowMs).toISOString(),
        };
        await saveEpisodeTask(requeued);
        recoveredCount += 1;
        updatedList.push(requeued);
        continue;
      } else {
        const failed: EpisodeTask = {
          ...task,
          status: 'failed',
          leaseExpiresAt: undefined,
          errorMessage: task.errorMessage || 'Max task retry attempts exceeded after lease expiry.',
          updatedAt: new Date(nowMs).toISOString(),
        };
        await saveEpisodeTask(failed);
        updatedList.push(failed);
        continue;
      }
    }
    updatedList.push(task);
  }

  return { recoveredCount, tasks: updatedList };
}
