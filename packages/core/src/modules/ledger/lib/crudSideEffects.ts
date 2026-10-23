import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import type { LedgerAccount, LedgerAccountType } from '../data/entities'

// Event and indexer configuration shared by every command that creates,
// updates or deletes a `LedgerAccount` / `LedgerAccountType` row — the
// single-row commands (`ledgerAccounts.ts`, `ledgerAccountTypes.ts`) and the
// bulk `importDefaultChartOfAccounts`, so imported rows reach search and
// subscribers exactly like rows created one at a time.

export const ledgerAccountCrudEvents: CrudEventsConfig<LedgerAccount> = {
  module: 'ledger',
  entity: 'ledger_account',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const ledgerAccountCrudIndexer: CrudIndexerConfig<LedgerAccount> = {
  entityType: E.ledger.ledger_account,
}

export const ledgerAccountTypeCrudEvents: CrudEventsConfig<LedgerAccountType> = {
  module: 'ledger',
  entity: 'ledger_account_type',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const ledgerAccountTypeCrudIndexer: CrudIndexerConfig<LedgerAccountType> = {
  entityType: E.ledger.ledger_account_type,
}
