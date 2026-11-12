import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * legal_review module injection table.
 *
 * Mounts the legal matter header on the document page header spot
 * (`detail:documents.document:header`). The documents page renders the spot with
 * `{ documentId, document, summary }`; this module owns everything it shows.
 */
export const injectionTable: ModuleInjectionTable = {
  'detail:documents.document:header': [
    {
      widgetId: 'legal_review.injection.matter-header',
      priority: 100,
    },
  ],
}

export default injectionTable
