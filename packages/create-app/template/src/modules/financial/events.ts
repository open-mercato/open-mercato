import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * The ledger's events, declared so the bus can name them, a workflow trigger can
 * select them, and a subscriber can depend on them with a type.
 *
 * Two families, and the distinction matters:
 *
 * - **`crud`** — emitted by the side-effect emitter on every write
 *   (`financial.<entity>.created|updated|deleted`), carrying only identifiers.
 *   The delete action is a **soft** one: an account is archived (and refuses to
 *   be while it holds postings), never removed, which is why the event a
 *   consumer sees is the CRUD `deleted` rather than a bespoke `archived`.
 * - **`lifecycle`** — the state transitions that are the reason this module
 *   exists. A posted entry is immutable, so "it was posted" is the only moment
 *   the ledger's contents changed; a VAT return, an AR/AP posting or any later
 *   phase hangs off `financial.journal_entry.posted` rather than off the generic
 *   `updated` that a draft edit produces just as well.
 */
const events = [
  { id: 'financial.account.created', label: 'GL Account Created', entity: 'account', category: 'crud' },
  { id: 'financial.account.updated', label: 'GL Account Updated', entity: 'account', category: 'crud' },
  {
    id: 'financial.account.deleted',
    label: 'GL Account Archived',
    description: 'The account left the chart of accounts. Accounts are archived, never removed: the row keeps the postings that reference it.',
    entity: 'account',
    category: 'crud',
  },

  { id: 'financial.period.created', label: 'Accounting Period Created', entity: 'period', category: 'crud' },
  { id: 'financial.period.updated', label: 'Accounting Period Updated', entity: 'period', category: 'crud' },
  { id: 'financial.period.deleted', label: 'Accounting Period Deleted', entity: 'period', category: 'crud' },
  { id: 'financial.period.closed', label: 'Accounting Period Closed', entity: 'period', category: 'lifecycle' },
  { id: 'financial.period.reopened', label: 'Accounting Period Reopened', entity: 'period', category: 'lifecycle' },

  { id: 'financial.journal_entry.created', label: 'Journal Entry Created', entity: 'journal_entry', category: 'crud' },
  { id: 'financial.journal_entry.updated', label: 'Journal Entry Updated', entity: 'journal_entry', category: 'crud' },
  { id: 'financial.journal_entry.deleted', label: 'Journal Entry Deleted', entity: 'journal_entry', category: 'crud' },
  {
    id: 'financial.journal_entry.posted',
    label: 'Journal Entry Posted',
    description: 'A draft entry became part of the ledger. The only event a tax or reporting consumer should follow — the entry is immutable from here.',
    entity: 'journal_entry',
    category: 'lifecycle',
  },
  {
    id: 'financial.journal_entry.reversed',
    label: 'Journal Entry Reversed',
    description: 'A posted entry was corrected by a mirror entry; both ids travel in the payload.',
    entity: 'journal_entry',
    category: 'lifecycle',
  },
  {
    id: 'financial.opening_balances.posted',
    label: 'Opening Balances Posted',
    description: 'A set of opening balances became one posted entry of type `opening`. Carries the entry id and the total, so a consumer can tell a freshly opened ledger from a trading one.',
    entity: 'journal_entry',
    category: 'lifecycle',
  },

  { id: 'financial.payment_method.created', label: 'Payment Method Created', entity: 'payment_method', category: 'crud' },
  { id: 'financial.payment_method.updated', label: 'Payment Method Updated', entity: 'payment_method', category: 'crud' },
  { id: 'financial.payment_method.deleted', label: 'Payment Method Archived', entity: 'payment_method', category: 'crud' },
  { id: 'financial.cash_account.created', label: 'Cash Account Created', entity: 'cash_account', category: 'crud' },
  { id: 'financial.cash_account.updated', label: 'Cash Account Updated', entity: 'cash_account', category: 'crud' },
  { id: 'financial.cash_account.deleted', label: 'Cash Account Archived', entity: 'cash_account', category: 'crud' },
  {
    id: 'financial.payment.recorded',
    label: 'Payment Recorded',
    description: 'Money moved in or out and was posted to the ledger. Carries the direction, the amount, the method code and the entry that was posted.',
    entity: 'payment',
    category: 'lifecycle',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'financial',
  events,
})

export const emitFinancialEvent = eventsConfig.emit
export type FinancialEventId = (typeof events)[number]['id']

export default eventsConfig
