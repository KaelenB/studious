import { createApiClient, type Account, type Snapshot } from '@studious/api';

export {
  accountTypes,
  moneyPattern,
  ApiError,
  type Household,
  type Member,
  type Account,
  type Snapshot,
  type AccountInput,
} from '@studious/api';

export const api = createApiClient(import.meta.env.VITE_API_BASE_URL || '/api');

export const accountLabels: Record<Account['type'], string> = {
  CHEQUING: 'Chequing',
  SAVINGS: 'Savings',
  INVESTMENT: 'Investment',
  CREDIT: 'Credit',
  LOAN: 'Loan',
  MORTGAGE: 'Mortgage',
};

export type AccountSummary = { account: Account; latest: Snapshot | null };

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
