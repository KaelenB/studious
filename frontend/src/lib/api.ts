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

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = createApiClient(apiBaseUrl);

export const accountLabels: Record<Account['type'], string> = {
  CHEQUING: 'Chequing',
  SAVINGS: 'Savings',
  INVESTMENT: 'Investment',
  CREDIT: 'Credit',
  LOAN: 'Loan',
  MORTGAGE: 'Mortgage',
};

export type AccountSummary = { account: Account; latest: Snapshot | null };

export function errorMessage(
  error: unknown,
  baseUrl = apiBaseUrl,
  origin = globalThis.location?.origin ?? 'this site',
) {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.';
  // Hosted builds (e.g. GitHub Pages) call an API on the visitor's computer; say where.
  if (error.message.startsWith('Cannot reach the backend') && /^https?:\/\//.test(baseUrl)) {
    return `Cannot reach the Studious API at ${baseUrl}. Start it on this computer with CORS_ORIGINS set to ${origin}.`;
  }
  return error.message;
}
