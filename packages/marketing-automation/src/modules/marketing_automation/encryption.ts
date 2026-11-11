import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * The two places this module holds free text it did not write.
 *
 * Everything else in its schema is ids, counts, timestamps and enum-shaped strings — which is why the module
 * shipped without a declaration at all. These two are different, and core already encrypts the equivalent of
 * the first:
 *
 *  - a survey comment is the customer's own words, the one field in this module they wrote themselves, and the
 *    one that can therefore contain anything including their own name;
 *  - a run's trigger payload is whatever a partner posted to an inbound hook — `readInboundPayload` copies
 *    every key through — so a first name, a phone number and an address all land in it.
 *
 * The trigger payload needed a column of its own to be encryptable at all. It used to live inside the run's
 * `context` jsonb, and the erasure reads that jsonb with SQL (`context ->> 'subjectEntityId'`), which an
 * encrypted column cannot answer. Splitting the free-form half out leaves the queryable half queryable: see
 * `Migration20261002110000_marketing_trigger_context` and `lib/run-context.ts`.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'marketing_automation:marketing_survey_prompt',
    fields: [
      { field: 'comment' },
    ],
  },
  {
    entityId: 'marketing_automation:marketing_campaign_run',
    fields: [
      { field: 'trigger_context' },
    ],
  },
]

export default defaultEncryptionMaps
