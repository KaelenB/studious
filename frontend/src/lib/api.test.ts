import { afterEach, expect, it, vi } from 'vitest';
import { api, accountLabels } from './api';
import { accountTypes } from '@studious/api';

afterEach(() => vi.unstubAllGlobals());

it('configures the distributed backend client for the same-origin proxy', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"ok"}'));
  vi.stubGlobal('fetch', fetch);
  expect(await api.health()).toEqual({ status: 'ok', database: 'ok' });
  expect(fetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
  expect(Object.keys(accountLabels)).toEqual([...accountTypes]);
});
