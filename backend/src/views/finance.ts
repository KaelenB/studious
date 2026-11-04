import type { Account, BalanceSnapshot, Household, Member } from '../models/schema.js';
import type {
  Account as AccountResponse,
  Household as HouseholdResponse,
  Member as MemberResponse,
  Snapshot as SnapshotResponse,
} from '@studious/api';

function timestamps(model: { createdAt: Date; updatedAt: Date }) {
  return {
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

export function householdView(model: Household): HouseholdResponse {
  return {
    id: model.id,
    name: model.name,
    defaultCurrency: model.defaultCurrency,
    ...timestamps(model),
  };
}

export function memberView(model: Member): MemberResponse {
  return {
    id: model.id,
    householdId: model.householdId,
    name: model.name,
    ...timestamps(model),
  };
}

export function accountView(model: Account): AccountResponse {
  return {
    id: model.id,
    householdId: model.householdId,
    memberId: model.memberId,
    name: model.name,
    type: model.type,
    subtype: model.subtype,
    currency: model.currency,
    balanceSource: model.balanceSource,
    deletedAt: model.deletedAt?.toISOString() ?? null,
    ...timestamps(model),
  };
}

export function snapshotView(model: BalanceSnapshot): SnapshotResponse {
  return {
    id: model.id,
    householdId: model.householdId,
    accountId: model.accountId,
    amount: model.amount,
    asOf: model.asOf.toISOString(),
    source: model.source,
    ...timestamps(model),
  };
}
