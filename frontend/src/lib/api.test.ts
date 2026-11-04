import { afterEach, expect, it, vi } from 'vitest';
import { api, accountLabels, errorMessage } from './api';
import { accountTypes } from '@studious/api';

afterEach(() => vi.unstubAllGlobals());

it('configures the distributed backend client for the same-origin proxy', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"ok"}'));
  vi.stubGlobal('fetch', fetch);
  expect(await api.health()).toEqual({ status: 'ok', database: 'ok' });
  expect(fetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
  expect(Object.keys(accountLabels)).toEqual([...accountTypes]);
});

it('explains where a hosted build expects the API when it is unreachable', () => {
  const offline = new Error('Cannot reach the backend. Check that the API is running.');
  expect(errorMessage(offline, '/api')).toBe(offline.message);
  expect(errorMessage(offline, 'http://127.0.0.1:3000', 'https://kaelenb.github.io')).toBe(
    'Cannot reach the Studious API at http://127.0.0.1:3000. Start it on this computer with CORS_ORIGINS set to https://kaelenb.github.io.',
  );
  expect(errorMessage('nope')).toBe('Something went wrong. Please try again.');
});
