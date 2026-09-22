import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Ledger Module Events
 *
 * `ledger.journal_entry.posted` is emitted by both `postJournalEntry` and
 * `reverseJournalEntry` after the entry's transaction commits (**corrected
 * 2026-09-14** in the spec: an earlier draft emitted it only from
 * `postJournalEntry`, but a `REVERSAL` entry is posted by a distinct command
 * and is the same kind of committed `JournalEntry` — a downstream
 * subscriber must see both). This is the only way another module (e.g.
 * Posting Rules Engine) may react to a posting, per
 * `packages/events/AGENTS.md`'s ban on direct cross-module calls — `ledger`
 * has no subscribers of its own and no knowledge of any consumer.
 *
 * Whether a given subscriber needs at-least-once delivery is that
 * subscriber's own choice (`metadata.persistent` on the subscription, not a
 * property of this declaration — **corrected 2026-09-18** per an
 * independent review's M2 finding).
 *
 * See `.ai/specs/2026-08-18-general-ledger-core-engine.md` § Events for the
 * payload's rationale (enough for an idempotent subscriber to act without a
 * second read back to `ledger`).
 */
const events = [
  {
    id: 'ledger.journal_entry.posted',
    label: 'Journal Entry Posted',
    entity: 'journal_entry',
    category: 'lifecycle',
  },

  // Standard CRUD events for the module's master-data entities (OM-9/OM-10),
  // declared together up front like currencies/events.ts does — `deleted`
  // is included now even though no delete command exists yet (OM-11 wires
  // soft-delete through `makeCrudRoute`), since declaring it costs nothing
  // and matches this repo's convention of declaring a full CRUD triple.
  { id: 'ledger.ledger_account.created', label: 'Ledger Account Created', entity: 'ledger_account', category: 'crud' },
  { id: 'ledger.ledger_account.updated', label: 'Ledger Account Updated', entity: 'ledger_account', category: 'crud' },
  { id: 'ledger.ledger_account.deleted', label: 'Ledger Account Deleted', entity: 'ledger_account', category: 'crud' },

  {
    id: 'ledger.ledger_account_type.created',
    label: 'Ledger Account Type Created',
    entity: 'ledger_account_type',
    category: 'crud',
  },
  {
    id: 'ledger.ledger_account_type.updated',
    label: 'Ledger Account Type Updated',
    entity: 'ledger_account_type',
    category: 'crud',
  },
  {
    id: 'ledger.ledger_account_type.deleted',
    label: 'Ledger Account Type Deleted',
    entity: 'ledger_account_type',
    category: 'crud',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'ledger',
  events,
})

/** Type-safe event emitter for the ledger module */
export const emitLedgerEvent = eventsConfig.emit

/** Event IDs that can be emitted by the ledger module */
export type LedgerEventId = typeof events[number]['id']

/** `ledger.journal_entry.posted` payload — see events.ts doc comment. */
export type LedgerJournalEntryPostedPayload = {
  journalEntryId: string
  sequenceNumber: number
  type: 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL'
  operationDate: string
  organizationId: string
  tenantId: string
  referenceType: string | null
  referenceId: string | null
  lines: { id: string; accountId: string; debit: string; credit: string }[]
}

export default eventsConfig
