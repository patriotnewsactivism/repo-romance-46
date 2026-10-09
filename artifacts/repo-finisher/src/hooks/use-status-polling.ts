import { useEffect, useRef } from "react";
import { ApiError } from "@workspace/api-client-react";

const POLL_INTERVAL_MS = 30_000;

function retryDelay(error: unknown): number {
  if (!(error instanceof ApiError) || error.status !== 429) return POLL_INTERVAL_MS;
  const retryAfter = error.headers.get("Retry-After");
  if (!retryAfter) return POLL_INTERVAL_MS;
  const seconds = Number(retryAfter);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(delay) ? Math.max(POLL_INTERVAL_MS, delay) : POLL_INTERVAL_MS;
}

/** Poll active work without overlapping requests or spending quota in hidden tabs. */
export function useStatusPolling(
  key: string | null,
  poll: (signal: AbortSignal) => Promise<unknown>,
) {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let inFlight = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let nextPollAt = Date.now() + POLL_INTERVAL_MS;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.hidden || inFlight) return;
      timer = window.setTimeout(pollOnce, Math.max(0, nextPollAt - Date.now()));
    };

    const pollOnce = async () => {
      timer = undefined;
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      let delay = POLL_INTERVAL_MS;
      try {
        await pollRef.current(controller.signal);
      } catch (error) {
        delay = retryDelay(error);
      } finally {
        inFlight = false;
        nextPollAt = Date.now() + delay;
        schedule();
      }
    };

    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [key]);
}
