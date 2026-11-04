import { describe, expect, it } from 'vitest';
import type { Account, BalanceSnapshot, Household, Member } from '../src/models/schema.js';
import { accountView, householdView, memberView, snapshotView } from '../src/views/finance.js';

const time = new Date('2026-01-01T00:00:00Z');
const timestamps = { createdAt: time, updatedAt: time };

describe('JSON response views', () => {
  it('explicitly selects household and member fields', () => {
    const household: Household = {
      id: 'home',
      name: 'Home',
      defaultCurrency: 'CAD',
      ...timestamps,
    };
    const member: Member = {
      id: 'member',
      householdId: 'home',
      name: 'Alex',
      ...timestamps,
    };
    const privateHousehold = { ...household, internalNotes: 'not public' };
    const privateMember = { ...member, internalNotes: 'not public' };
    expect(householdView(privateHousehold)).toEqual({
      id: 'home',
      name: 'Home',
      defaultCurrency: 'CAD',
      createdAt: time.toISOString(),
      updatedAt: time.toISOString(),
    });
    expect(memberView(privateMember)).toEqual({
      id: 'member',
      householdId: 'home',
      name: 'Alex',
      createdAt: time.toISOString(),
      updatedAt: time.toISOString(),
    });
  });

  it('serializes dates and nulls without exposing future account columns', () => {
    const account: Account = {
      id: 'account',
      householdId: 'home',
      memberId: null,
      name: 'Bank',
      type: 'CHEQUING',
      subtype: null,
      currency: 'CAD',
      balanceSource: 'MANUAL',
      deletedAt: null,
      ...timestamps,
    };
    const privateAccount = { ...account, encryptedCredentials: 'not public' };
    expect(accountView(privateAccount)).toEqual({
      id: 'account',
      householdId: 'home',
      memberId: null,
      name: 'Bank',
      type: 'CHEQUING',
      subtype: null,
      currency: 'CAD',
      balanceSource: 'MANUAL',
      deletedAt: null,
      createdAt: time.toISOString(),
      updatedAt: time.toISOString(),
    });
    expect(accountView({ ...account, deletedAt: time }).deletedAt).toBe(time.toISOString());
  });

  it('keeps monetary precision and exposes only snapshot response fields', () => {
    const snapshot: BalanceSnapshot = {
      id: 'snapshot',
      householdId: 'home',
      accountId: 'account',
      amount: '123456789012.34',
      asOf: time,
      source: 'MANUAL',
      ...timestamps,
    };
    const privateSnapshot = { ...snapshot, providerPayload: 'not public' };
    expect(snapshotView(privateSnapshot)).toEqual({
      id: 'snapshot',
      householdId: 'home',
      accountId: 'account',
      amount: '123456789012.34',
      asOf: time.toISOString(),
      source: 'MANUAL',
      createdAt: time.toISOString(),
      updatedAt: time.toISOString(),
    });
    expect(snapshot.asOf).toBe(time);
  });
});
