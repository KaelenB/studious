import { z } from 'zod';
import {
  accountBody,
  accountParams,
  accountSchema,
  accountUpdateBody,
  healthSchema,
  storageSchema,
  historyQuery,
  householdBody,
  householdParams,
  householdSchema,
  memberBody,
  memberSchema,
  snapshotBody,
  snapshotSchema,
  type AccountInput,
  type AccountUpdate,
  expenseBody,
  expenseUpdateBody,
  expenseParams,
  expenseQuery,
  expenseCategoryBody,
  expenseCategorySchema,
  expenseSchema,
  expensePageSchema,
  type ExpenseInput,
  type ExpenseUpdate,
  statementFileLimit,
  statementParams,
  statementQuery,
  statementPreviewSchema,
  statementSchema,
} from './contracts.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** Transport override, e.g. a test double. Defaults to the global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createApiClient(baseUrl: string, options: ApiClientOptions = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const transport = options.fetch ?? ((input, init) => fetch(input, init));

  async function responseFor(path: string, options: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await transport(`${base}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new Error('Cannot reach the backend. Check that the API is running.');
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiError(
          response.status,
          `Request failed (${response.status}); the backend did not return JSON.`,
        );
      }
      const parsed = z.object({ error: z.string() }).safeParse(body);
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error : `Request failed (${response.status}).`,
      );
    }
    return response;
  }

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await responseFor(path, options);
    if (response.status === 204) return schema.parse(undefined);
    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        'The backend returned an unexpected response. Please refresh or check the API version.',
      );
    }
    return parsed.data;
  }

  function pathFor(id: string) {
    householdParams.parse({ householdId: id });
    return `/households/${encodeURIComponent(id)}`;
  }
  function accountPath(id: string, accountId: string) {
    accountParams.parse({ householdId: id, accountId });
    return `${pathFor(id)}/accounts/${encodeURIComponent(accountId)}`;
  }
  function expensePath(id: string, expenseId: string) {
    expenseParams.parse({ householdId: id, expenseId });
    return `${pathFor(id)}/expenses/${encodeURIComponent(expenseId)}`;
  }
  const json = (body: unknown) => JSON.stringify(body);
  function pdfUpload(file: Blob, filename: string, signal?: AbortSignal): RequestInit {
    if (!file.size || file.size > statementFileLimit)
      throw new Error('Choose a PDF or XLSX no larger than 10 MiB.');
    return {
      method: 'POST',
      headers: {
        'Content-Type': /\.xlsx$/i.test(filename)
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      },
      body: file,
      signal,
    };
  }
  function statementUploadPath(
    id: string,
    accountId: string,
    filename: string,
    preview: boolean,
    statementDate?: string,
  ) {
    const query = statementQuery.parse({ filename, statementDate });
    return `${accountPath(id, accountId)}/statements${preview ? '/preview' : ''}?filename=${encodeURIComponent(query.filename)}${query.statementDate ? `&statementDate=${query.statementDate}` : ''}`;
  }

  return {
    health: (signal?: AbortSignal) => request('/health', healthSchema, { signal }),
    storage: (signal?: AbortSignal) => request('/storage', storageSchema, { signal }),
    createHousehold: (name: string, defaultCurrency: string) =>
      request('/households', householdSchema, {
        method: 'POST',
        body: json(householdBody.parse({ name, defaultCurrency })),
      }),
    household: (id: string, signal?: AbortSignal) =>
      request(pathFor(id), householdSchema, { signal }),
    members: (id: string, signal?: AbortSignal) =>
      request(`${pathFor(id)}/members`, z.array(memberSchema), { signal }),
    addMember: (id: string, name: string) =>
      request(`${pathFor(id)}/members`, memberSchema, {
        method: 'POST',
        body: json(memberBody.parse({ name })),
      }),
    accounts: (id: string, signal?: AbortSignal) =>
      request(`${pathFor(id)}/accounts`, z.array(accountSchema), { signal }),
    addAccount: (id: string, input: AccountInput) =>
      request(`${pathFor(id)}/accounts`, accountSchema, {
        method: 'POST',
        body: json(accountBody.parse(input)),
      }),
    updateAccount: (id: string, accountId: string, input: AccountUpdate) =>
      request(accountPath(id, accountId), accountSchema, {
        method: 'PATCH',
        body: json(accountUpdateBody.parse(input)),
      }),
    archiveAccount: (id: string, accountId: string) =>
      request(accountPath(id, accountId), z.undefined(), { method: 'DELETE' }),
    balances: (id: string, accountId: string, limit = 20, offset = 0, signal?: AbortSignal) => {
      const query = historyQuery.parse({ limit, offset });
      return request(
        `${accountPath(id, accountId)}/balances?limit=${query.limit}&offset=${query.offset}`,
        z.array(snapshotSchema),
        { signal },
      );
    },
    addBalance: (id: string, accountId: string, amount: string, asOf: string) =>
      request(`${accountPath(id, accountId)}/balances`, snapshotSchema, {
        method: 'POST',
        body: json(snapshotBody.parse({ amount, asOf })),
      }),
    expenseCategories: (id: string, signal?: AbortSignal) =>
      request(`${pathFor(id)}/expense-categories`, z.array(expenseCategorySchema), { signal }),
    addExpenseCategory: (id: string, name: string) =>
      request(`${pathFor(id)}/expense-categories`, expenseCategorySchema, {
        method: 'POST',
        body: json(expenseCategoryBody.parse({ name })),
      }),
    expenses: (id: string, month: string, limit = 20, offset = 0, signal?: AbortSignal) => {
      const query = expenseQuery.parse({ month, limit, offset });
      return request(
        `${pathFor(id)}/expenses?month=${query.month}&limit=${query.limit}&offset=${query.offset}`,
        expensePageSchema,
        { signal },
      );
    },
    addExpense: (id: string, input: ExpenseInput) =>
      request(`${pathFor(id)}/expenses`, expenseSchema, {
        method: 'POST',
        body: json(expenseBody.parse(input)),
      }),
    updateExpense: (id: string, expenseId: string, input: ExpenseUpdate) =>
      request(expensePath(id, expenseId), expenseSchema, {
        method: 'PATCH',
        body: json(expenseUpdateBody.parse(input)),
      }),
    archiveExpense: (id: string, expenseId: string) =>
      request(expensePath(id, expenseId), z.undefined(), { method: 'DELETE' }),
    previewStatement: (
      id: string,
      accountId: string,
      filename: string,
      file: Blob,
      signal?: AbortSignal,
      statementDate?: string,
    ) =>
      request(
        statementUploadPath(id, accountId, filename, true, statementDate),
        statementPreviewSchema,
        pdfUpload(file, filename, signal),
      ),
    importStatement: (
      id: string,
      accountId: string,
      filename: string,
      file: Blob,
      statementDate?: string,
    ) =>
      request(
        statementUploadPath(id, accountId, filename, false, statementDate),
        statementSchema,
        pdfUpload(file, filename),
      ),
    statements: (id: string, accountId: string, limit = 20, offset = 0, signal?: AbortSignal) => {
      const query = historyQuery.parse({ limit, offset });
      return request(
        `${accountPath(id, accountId)}/statements?limit=${query.limit}&offset=${query.offset}`,
        z.array(statementSchema),
        { signal },
      );
    },
    extractStatementInvestments(id: string, accountId: string, statementId: string) {
      statementParams.parse({ householdId: id, accountId, statementId });
      return request(
        `${accountPath(id, accountId)}/statements/${encodeURIComponent(statementId)}/investments`,
        statementSchema,
        { method: 'POST' },
      );
    },
    async downloadStatement(id: string, accountId: string, statementId: string) {
      statementParams.parse({ householdId: id, accountId, statementId });
      const response = await responseFor(
        `${accountPath(id, accountId)}/statements/${encodeURIComponent(statementId)}/file`,
      );
      if (
        ![
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ].includes(response.headers.get('Content-Type')?.split(';')[0] ?? '')
      ) {
        throw new Error('The backend did not return an archived document.');
      }
      return response.blob();
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
