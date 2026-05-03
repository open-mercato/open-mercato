import { MATERIAL_CUSTOM_FIELDS } from './customFieldDefaults'

/**
 * Custom-fields-extensible entities for the materials module.
 *
 * Phase 1 ships only the master Material as customer-extensible. Child entities (units,
 * supplier links, prices, sales profile, lifecycle events) are intentionally left out:
 * they're tightly coupled to the master and adding custom fields per child row would create
 * a UX maze. Phase 2 may revisit suppliers if procurement teams ask.
 *
 * `id` is pinned to `materials:material` per spec — the same string is used by translations.ts,
 * search.ts entity registration, and the query engine's customFieldSources joinOn alias.
 */
export const entities = [
  {
    id: 'materials:material',
    label: 'Material',
    description: 'ERP master record for stockable, purchasable, sellable, or producible items.',
    labelField: 'name',
    showInSidebar: false,
    fields: MATERIAL_CUSTOM_FIELDS,
  },
]

export default entities
