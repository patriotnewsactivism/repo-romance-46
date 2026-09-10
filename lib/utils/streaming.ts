/**
 * Conceptual placeholder for WebSockets/SSE real-time progress streaming.
 */

export function createProgressStream(sessionId: string) {
  // In production: return a ReadableStream or SSE response
  return {
    write: (event: string, data: unknown) => {
      console.debug(`[stream ${sessionId}] ${event}`, data);
    },
    close: () => {
      console.debug(`[stream ${sessionId}] closed`);
    },
  };
}
