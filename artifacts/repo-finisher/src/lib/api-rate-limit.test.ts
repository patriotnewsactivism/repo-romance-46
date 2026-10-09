import assert from 'node:assert/strict';
import { test } from 'vitest';
import { extendRateLimitCooldown, readRateLimitCooldown } from './api-rate-limit.ts';

const now = Date.parse('2026-10-09T12:00:00Z');
const limited = (headers: Record<string, string> = {}, data: unknown = {}) => ({ status: 429, headers: new Headers(headers), data });

test('Retry-After delta seconds takes precedence over reset and body hints', () => {
  assert.deepEqual(readRateLimitCooldown(limited({ 'Retry-After': '90', RateLimit: 'limit=120, remaining=0, reset=10' }, {
    code: 'API_RATE_LIMITED', retry_after: 20,
  }), now), { retryAt: now + 90_000, scope: 'api' });
});

test('Retry-After HTTP dates use the server deadline and expired dates allow retry', () => {
  assert.equal(readRateLimitCooldown(limited({ 'Retry-After': 'Fri, 09 Oct 2026 12:02:00 GMT' }), now)?.retryAt, now + 120_000);
  assert.equal(readRateLimitCooldown(limited({ 'Retry-After': 'Fri, 09 Oct 2026 11:59:00 GMT' }), now)?.retryAt, now);
});

test('invalid Retry-After falls back to RateLimit reset, body, then 60 seconds', () => {
  assert.equal(readRateLimitCooldown(limited({ 'Retry-After': 'garbage', RateLimit: 'limit=120, remaining=0, reset=42' }), now)?.retryAt, now + 42_000);
  assert.equal(readRateLimitCooldown(limited({ RateLimit: '"api";r=0;t=50' }), now)?.retryAt, now + 50_000);
  assert.equal(readRateLimitCooldown(limited({}, { retry_after: 35 }), now)?.retryAt, now + 35_000);
  assert.equal(readRateLimitCooldown(limited({ RateLimit: 'reset=42garbage' }), now)?.retryAt, now + 60_000);
  for (const invalid of ['', '-1', 'garbage']) {
    assert.equal(readRateLimitCooldown(limited({ 'Retry-After': invalid }), now)?.retryAt, now + 60_000);
  }
});

test('zero wait hints are preserved and malformed body values use the fallback', () => {
  assert.equal(readRateLimitCooldown(limited({ 'Retry-After': '0', RateLimit: 'reset=60' }), now)?.retryAt, now);
  assert.equal(readRateLimitCooldown(limited({}, { retry_after: 0 }), now)?.retryAt, now);
  assert.equal(readRateLimitCooldown(limited({}, { retry_after: -20 }), now)?.retryAt, now + 60_000);
});

test('only explicit upstream provider errors get a provider-only cooldown', () => {
  assert.equal(readRateLimitCooldown(limited({}, { code: 'AI_PROVIDER_RATE_LIMITED' }), now)?.scope, 'provider');
  assert.equal(readRateLimitCooldown(limited({}, { error: 'Too many requests' }), now)?.scope, 'unknown');
  assert.equal(readRateLimitCooldown({ status: 503 }, now), null);
  assert.equal(readRateLimitCooldown(new Error('429'), now), null);
});

test('a concurrent shorter failure cannot release an existing cooldown early', () => {
  const current = { retryAt: now + 120_000, scope: 'api' as const };
  assert.equal(extendRateLimitCooldown(current, { retryAt: now + 60_000, scope: 'unknown' }), current);
  assert.deepEqual(extendRateLimitCooldown(current, { retryAt: now + 150_000, scope: 'api' }), {
    retryAt: now + 150_000, scope: 'api',
  });
});
