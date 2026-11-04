import type { Mortgage, MortgageProjection, MortgageTerms, Prepayment } from '@studious/api';
import type { MortgagePrepaymentRow, MortgageTermsRow } from '../models/schema.js';

export function mortgageTermsView(model: MortgageTermsRow): MortgageTerms {
  return {
    accountId: model.accountId,
    householdId: model.householdId,
    principal: model.principal,
    annualRate: model.annualRate,
    rateType: model.rateType,
    compounding: model.compounding,
    amortizationMonths: model.amortizationMonths,
    termMonths: model.termMonths,
    paymentFrequency: model.paymentFrequency,
    startDate: model.startDate,
    paymentAmount: model.paymentAmount,
    propertyValue: model.propertyValue,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

export function prepaymentView(model: MortgagePrepaymentRow): Prepayment {
  return {
    id: model.id,
    householdId: model.householdId,
    accountId: model.accountId,
    amount: model.amount,
    date: model.date,
    note: model.note,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

export function mortgageView(model: {
  terms: MortgageTermsRow | null;
  prepayments: MortgagePrepaymentRow[];
  projection: MortgageProjection | null;
}): Mortgage {
  return {
    terms: model.terms ? mortgageTermsView(model.terms) : null,
    prepayments: model.prepayments.map(prepaymentView),
    projection: model.projection,
  };
}
