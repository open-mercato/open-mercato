import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ClaimsAiTriggerWidget from './widget.client'

/**
 * Claims list AiChat injection widget.
 *
 * Mirrors the customers `ai-assistant-trigger` pattern: a compact "Ask AI"
 * trigger rendered in the claims list DataTable `:search-trailing` slot that
 * opens a right-side sheet embedding
 * `<AiChat agent="warranty_claims.claims_assistant" pageContext={...} />`.
 *
 * `pageContext` follows the spec §10.1 shape:
 *
 *   { view: 'warranty_claims.claims.list',
 *     recordType: null,
 *     recordId: string | null,               // comma-separated UUIDs or null
 *     extra: { selectedCount, totalMatching } }
 *
 * Feature-gated behind `ai_assistant.view` only — the host claims list page
 * already enforces `warranty_claims.claim.view`, so the widget gate just
 * needs to ensure the user has AI assistant access.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'warranty_claims.injection.claims-ai-trigger',
    title: 'Warranty Claims AI Assistant Trigger',
    description:
      'Renders an "Ask AI" button next to the claims list search input that opens a sheet embedding the claims assistant.',
    features: ['ai_assistant.view'],
    requiredModules: ['ai_assistant'],
    priority: 100,
    enabled: true,
  },
  Widget: ClaimsAiTriggerWidget,
}

export default widget
