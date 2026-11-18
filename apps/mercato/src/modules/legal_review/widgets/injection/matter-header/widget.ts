import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { LegalMatterHeaderContext } from '../../../lib/matterHeader'
import LegalMatterHeaderWidget from './widget.client'

/**
 * Legal matter header on the document page (`detail:documents.document:header`).
 *
 * The documents page only exposes the shared `<InjectionSpot>` with
 * `{ documentId, document, summary }`; this widget turns it into the matter's
 * reference, counterparty, chips, people and four-step stage tracker.
 */
const widget: InjectionWidgetModule<LegalMatterHeaderContext, Record<string, unknown>> = {
  metadata: {
    id: 'legal_review.injection.matter-header',
    title: 'Legal matter header',
    description: 'Shows the legal matter (reference, counterparty, people and stage) on the document page header.',
    features: ['legal_review.matters.view'],
    priority: 100,
    enabled: true,
  },
  Widget: LegalMatterHeaderWidget,
}

export default widget
