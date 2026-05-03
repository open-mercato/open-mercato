import { cf } from '@open-mercato/shared/modules/dsl'

/**
 * Default custom fields shipped with every fresh materials install.
 *
 * Per spec Phase 1 these two fields:
 * - `internal_notes` — multiline text for production team annotations.
 * - `safety_data_sheet_url` — URL to MSDS / SDS PDF for hazardous materials.
 *
 * Both are nullable + additive; existing tenants reconcile via `yarn mercato entities install`.
 */
export const MATERIAL_CUSTOM_FIELDS = [
  cf.multiline('internal_notes', {
    label: 'Internal notes',
    description: 'Production / engineering annotations not visible to customers.',
    listVisible: false,
  }),
  cf.text('safety_data_sheet_url', {
    label: 'Safety Data Sheet (SDS) URL',
    description: 'Link to the material safety datasheet (PDF). Required for hazardous goods compliance.',
  }),
]
