/**
 * OpenTelemetry semantic conventions placeholder for distributed tracing.
 * Full instrumentation would use @opentelemetry/api and exporters.
 */

export function startSpan(name: string, attributes: Record<string, string | number> = {}) {
  const start = Date.now();
  console.debug(`[trace] start ${name}`, attributes);
  return {
    end: (status: 'ok' | 'error' = 'ok') => {
      console.debug(`[trace] end ${name} ${status} ${Date.now() - start}ms`);
    },
    setAttribute: (key: string, value: string | number) => {
      attributes[key] = value;
    },
  };
}

export function withSpan<T>(name: string, fn: () => Promise<T>, attributes: Record<string, string | number> = {}): Promise<T> {
  const span = startSpan(name, attributes);
  return fn()
    .then((result) => {
      span.end('ok');
      return result;
    })
    .catch((err) => {
      span.end('error');
      throw err;
    });
}
