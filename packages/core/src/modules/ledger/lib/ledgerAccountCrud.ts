import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import type { LedgerAccount } from '../data/entities'

// Plain string, matching this module's own `encryption.ts` entityId
// convention (`'<module>:<table_name>'`).
export const LEDGER_ACCOUNT_ENTITY_ID = 'ledger:ledger_account'

// Shared by the account commands and by the account-type command, which
// renumbers dependent accounts and has to announce those updates too.
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
