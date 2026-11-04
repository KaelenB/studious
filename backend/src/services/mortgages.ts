import type { mortgageTermsBody, prepaymentBody } from '@studious/api';
import type { z } from 'zod';
import { amortizationProblem, projectMortgage } from '../domain/mortgage.js';
import type { MortgageRepository } from '../repositories/mortgages.js';
import { ApplicationError } from './errors.js';
import type { FinanceService } from './finance.js';

type TermsValues = z.output<typeof mortgageTermsBody>;
type PrepaymentValues = z.output<typeof prepaymentBody>;

const today = () => new Date().toISOString().slice(0, 10);

export function createMortgageService(repository: MortgageRepository, finance: FinanceService) {
  async function requireMortgageAccount(householdId: string, accountId: string) {
    const account = await finance.requireAccount(householdId, accountId);
    if (account.type !== 'MORTGAGE') {
      throw new ApplicationError(
        'CONFLICT',
        'Mortgage details are only available for mortgage accounts',
      );
    }
    return account;
  }
  async function requireTerms(householdId: string, accountId: string) {
    await requireMortgageAccount(householdId, accountId);
    const terms = await repository.findTerms(householdId, accountId);
    if (!terms) throw new ApplicationError('NOT_FOUND', 'Mortgage terms have not been set');
    return terms;
  }

  async function mortgage(householdId: string, accountId: string, asOf = today()) {
    await requireMortgageAccount(householdId, accountId);
    const terms = await repository.findTerms(householdId, accountId);
    if (!terms) return { terms: null, prepayments: [], projection: null };
    const prepayments = await repository.listPrepayments(householdId, accountId);
    return { terms, prepayments, projection: projectMortgage(terms, prepayments, asOf) };
  }

  return {
    mortgage,
    async saveTerms(householdId: string, accountId: string, values: TermsValues) {
      await requireMortgageAccount(householdId, accountId);
      const problem = amortizationProblem(values);
      if (problem) throw new ApplicationError('INVALID', problem);
      const earliest = (await repository.listPrepayments(householdId, accountId))[0];
      if (earliest && earliest.date < values.startDate) {
        throw new ApplicationError(
          'CONFLICT',
          'Remove prepayments dated before the new start date first',
        );
      }
      await repository.saveTerms(householdId, accountId, values);
      return mortgage(householdId, accountId);
    },
    async addPrepayment(householdId: string, accountId: string, values: PrepaymentValues) {
      const terms = await requireTerms(householdId, accountId);
      if (values.date < terms.startDate) {
        throw new ApplicationError(
          'INVALID',
          'Prepayments cannot be dated before the mortgage starts',
        );
      }
      return repository.addPrepayment({ ...values, householdId, accountId });
    },
    async deletePrepayment(householdId: string, accountId: string, prepaymentId: string) {
      await requireMortgageAccount(householdId, accountId);
      const prepayment = await repository.deletePrepayment(householdId, accountId, prepaymentId);
      if (!prepayment) throw new ApplicationError('NOT_FOUND', 'Prepayment not found');
    },
  };
}

export type MortgageService = ReturnType<typeof createMortgageService>;
