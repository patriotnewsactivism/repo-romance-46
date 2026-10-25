import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './api-base-url';

describe('API host selection', () => {
  it('uses the canonical API on the production site and Vercel previews', () => {
    for (const host of ['portfolio.donmatthews.live', 'preview.vercel.app']) {
      expect(resolveApiBaseUrl(undefined, host)).toBe('https://api.portfolio.donmatthews.live');
    }
  });

  it('rejects retired endpoints even when an old build variable is configured', () => {
    for (const value of ['https://repofinisher-api-production.up.railway.app/', 'https://retired-api.a.run.app']) {
      expect(resolveApiBaseUrl(value, 'portfolio.donmatthews.live')).toBe('https://api.portfolio.donmatthews.live');
      expect(resolveApiBaseUrl(value, 'localhost')).toBeUndefined();
    }
  });

  it('keeps local requests on the development proxy unless explicitly configured', () => {
    expect(resolveApiBaseUrl(undefined, 'localhost')).toBeUndefined();
    expect(resolveApiBaseUrl('http://localhost:5000/', 'localhost')).toBe('http://localhost:5000');
    expect(resolveApiBaseUrl(' https://api.example.com/ ', 'localhost')).toBe('https://api.example.com');
  });

  it('does not accept credentials, insecure remote hosts or an API path as an origin', () => {
    for (const value of ['invalid', 'http://api.example.com', 'https://key@api.example.com', 'https://api.example.com/api', 'https://api.example.com/?key=value']) {
      expect(resolveApiBaseUrl(value, 'portfolio.donmatthews.live')).toBe('https://api.portfolio.donmatthews.live');
    }
  });
});
