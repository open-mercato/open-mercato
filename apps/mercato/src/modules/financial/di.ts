import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  GlAccount,
  GlCashAccount,
  GlJournalEntry,
  GlJournalLine,
  GlPaymentMethod,
  GlPeriod,
} from './data/entities'
import { createFinancialLedgerService } from './lib/ledgerQuery'

export function register(container: AppContainer) {
  container.register({
    GlAccount: asValue(GlAccount),
    GlPeriod: asValue(GlPeriod),
    GlJournalEntry: asValue(GlJournalEntry),
    GlJournalLine: asValue(GlJournalLine),
    GlPaymentMethod: asValue(GlPaymentMethod),
    GlCashAccount: asValue(GlCashAccount),
    // The engine's reporting read model. A country plugin resolves this rather
    // than importing the ledger's entities, so the plugin layer never depends on
    // how the ledger stores a line.
    financialLedgerService: asFunction(createFinancialLedgerService).scoped(),
  })
}
