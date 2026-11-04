import { afterEach, expect, it, vi } from 'vitest';
import {
  api,
  accountKind,
  accountLabels,
  errorMessage,
  subtypeDescriptions,
  subtypeLabels,
} from './api';
import { accountTypes, investmentSubtypes } from '@studious/api';

afterEach(() => vi.unstubAllGlobals());

it('configures the distributed backend client for the same-origin proxy', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"ok"}'));
  vi.stubGlobal('fetch', fetch);
  expect(await api.health()).toEqual({ status: 'ok', database: 'ok' });
  expect(fetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
  expect(Object.keys(accountLabels)).toEqual([...accountTypes]);
});

it('labels every investment sub-type and combines it with the account type', () => {
  expect(Object.keys(subtypeLabels)).toEqual([...investmentSubtypes]);
  expect(Object.keys(subtypeDescriptions)).toEqual([...investmentSubtypes]);
  expect(accountKind({ type: 'INVESTMENT', subtype: 'DCPP' })).toBe('Investment \u00b7 DCPP');
  expect(accountKind({ type: 'INVESTMENT', subtype: 'NON_REGISTERED' })).toBe(
    'Investment \u00b7 Non-registered',
  );
  expect(accountKind({ type: 'SAVINGS', subtype: null })).toBe('Savings');
});

it('explains where a hosted build expects the API when it is unreachable', () => {
  const offline = new Error('Cannot reach the backend. Check that the API is running.');
  expect(errorMessage(offline, '/api')).toBe(offline.message);
  expect(errorMessage(offline, 'http://127.0.0.1:3000', 'https://kaelenb.github.io')).toBe(
    'Cannot reach the Studious API at http://127.0.0.1:3000. Check that it is running and reachable from this device, and that its CORS_ORIGINS includes https://kaelenb.github.io.',
  );
  expect(errorMessage('nope')).toBe('Something went wrong. Please try again.');
});
