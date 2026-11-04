import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, ApiError } from '../src/index.js';

const api = createApiClient('/api/');
const householdId = '5ac4a834-e62f-4d89-86a3-434bec7cd765';
const accountId = '583d01bb-3165-4e06-9d8b-9a65a7c013d0';

afterEach(() => vi.unstubAllGlobals());

describe('API boundary', () => {
  it('uses same-origin routes and JSON bodies', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '5ac4a834-e62f-4d89-86a3-434bec7cd765',
          name: 'Home',
          defaultCurrency: 'CAD',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await api.createHousehold('Home', 'CAD')).name).toBe('Home');
    expect(fetch).toHaveBeenCalledWith(
      '/api/households',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Home', defaultCurrency: 'CAD' }),
      }),
    );
  });
  it('rejects malformed success payloads instead of displaying invented data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(api.household(householdId)).rejects.toThrow('unexpected response');
  });
  it('surfaces server and network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ error: 'Household not found' }), { status: 404 }),
        ),
    );
    await expect(api.household(householdId)).rejects.toBeInstanceOf(ApiError);
    await expect(api.household(householdId)).rejects.toThrow('Household not found');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.household(householdId)).rejects.toThrow('Cannot reach the backend');
  });
  it('accepts empty archive responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await api.archiveAccount(householdId, accountId)).toBeUndefined();
  });
  it('rejects invalid requests before making a network call', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(() => api.household('invalid')).toThrow();
    expect(() => api.addBalance(householdId, accountId, '1.001', '2026-01-01T00:00:00Z')).toThrow();
    expect(() => api.addAccount(householdId, { name: ' ', type: 'SAVINGS' })).toThrow();
    expect(() => api.balances(householdId, accountId, 501)).toThrow();
    expect(() => api.updateAccount(householdId, accountId, {})).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves abort errors and passes the signal to fetch', async () => {
    const controller = new AbortController();
    const failure = new DOMException('Aborted', 'AbortError');
    const fetch = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('fetch', fetch);
    await expect(api.household(householdId, controller.signal)).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledWith(
      `/api/households/${householdId}`,
      expect.objectContaining({ signal: controller.signal }),
    );
  });
  it('reports non-JSON errors with their HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));
    await expect(api.household(householdId)).rejects.toMatchObject({ status: 502 });
  });
});
