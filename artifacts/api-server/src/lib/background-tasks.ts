import { logger } from "./logger";

const activeTasks = new Set<Promise<unknown>>();

export function runInBackground(job: Promise<unknown>, label = "background-task"): void {
  let tracked: Promise<unknown>;
  tracked = Promise.resolve(job)
    .catch((error) => {
      logger.error({ err: error, label }, "Background task failed");
    })
    .finally(() => {
      activeTasks.delete(tracked);
    });
  activeTasks.add(tracked);
}

export function backgroundTaskCount(): number {
  return activeTasks.size;
}

export async function drainBackgroundTasks(timeoutMs = 10_000): Promise<void> {
  if (activeTasks.size === 0) return;
  const snapshot = [...activeTasks];
  let timeout;
  const timer = new Promise((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
    timeout.unref?.();
  });
  await Promise.race([Promise.allSettled(snapshot), timer]);
  if (timeout) clearTimeout(timeout);
}
