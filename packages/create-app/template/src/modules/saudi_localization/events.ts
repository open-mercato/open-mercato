import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * The compliance events. Two, and both are facts an operator may need to prove
 * later rather than notifications:
 *
 * - **`zatca.invoice.issued`** — a document was issued and its hash/ICV were
 *   persisted. Nothing has been sent to ZATCA (see
 *   `lib/saudi/e-invoicing.ts`), so the payload says the submission is pending;
 *   a consumer must not read this as "cleared".
 * - **`vat_return.generated`** — a return was read off the ledger for a period.
 *   Generating changes nothing, but which figures were reported, and when, is
 *   the kind of thing an audit asks for.
 */
const events = [
  {
    id: 'saudi_localization.zatca.invoice.issued',
    label: 'ZATCA Invoice Issued',
    description: 'An e-invoice was issued and its hash, ICV and XML persisted locally. Submission to ZATCA is pending until CSID onboarding lands.',
    entity: 'zatca_invoice',
    category: 'custom',
  },
  {
    id: 'saudi_localization.vat_return.generated',
    label: 'Saudi VAT Return Generated',
    description: 'A VAT return was computed from the period’s posted tax lines. Read-only: nothing is posted and nothing is filed.',
    entity: 'vat_return',
    category: 'custom',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'saudi_localization',
  events,
})

export const emitSaudiLocalizationEvent = eventsConfig.emit
export type SaudiLocalizationEventId = (typeof events)[number]['id']

export default eventsConfig
