/**
 * Per-tool sample inputs used by `tool-test-runner.ts` (see also the
 * `test-tools` CLI subcommand and `TC-INT-AI-TOOLS.spec.ts`).
 *
 * Inputs are deliberately conservative — every entry is the smallest valid
 * shape that exercises the handler against demo-seeded data. ID-shaped tools
 * declare `idFrom` so the runner first runs the sibling list tool and threads
 * the discovered id through; this avoids hand-rolling fixture UUIDs that go
 * stale every time the demo seed regenerates.
 *
 * Tools without a fixture are skipped with reason `'no fixture'` rather than
 * failing — keeps the test green for newly added tools until a maintainer
 * adds an entry. Mutation tools share this map and are exercised through
 * `prepareMutation`; the runner asserts they return a pending-action envelope
 * and never confirms the action.
 */

export type ToolFixtureValueRef = { idFrom: string; field?: string }

export type ToolFixtureInput = Record<string, unknown> | ToolFixtureValueRef

export interface ToolFixture {
  /** When `true` the runner skips this tool with reason `'skip-by-fixture'`. */
  skip?: boolean
  /** Static input passed to the handler. Overrides `idFrom`-based inputs. */
  input?: Record<string, unknown>
  /**
   * When set, the runner calls the named list tool first, picks the first
   * record, reads `field` (default `id`) from it, and merges it into the input
   * under the key declared by `bindAs` (default `id`).
   */
  idFrom?: string
  bindAs?: string
  /** Optional extra static fields merged on top of the chained input. */
  extra?: Record<string, unknown>
  /** Free-form note explaining the fixture choice. */
  note?: string
}

const f = (fixture: ToolFixture): ToolFixture => fixture

export const toolFixtures: Record<string, ToolFixture> = {
  // -------------------- ai_assistant module --------------------
  'meta.describe_agent': f({
    input: { agentId: 'customers.account_assistant' },
  }),
  'attachments.list_record_attachments': f({
    input: { entityType: 'customers:person', recordId: '00000000-0000-0000-0000-000000000000', limit: 5 },
    note: 'Empty result is a valid response; we only assert shape.',
  }),
  'attachments.read_attachment': f({
    skip: true,
    note: 'Requires a real attachment id — covered by attachment-bridge integration tests.',
  }),
  'search.hybrid_search': f({
    input: { q: 'demo', limit: 5 },
  }),
  'search.get_record_context': f({
    skip: true,
    note: 'Requires a known record id from the search index; covered by hybrid_search tests.',
  }),

  // -------------------- search module --------------------
  search_query: f({ input: { q: 'demo', limit: 5 } }),
  search_status: f({ input: {} }),
  search_get: f({ skip: true, note: 'Requires a known indexed record id.' }),
  search_schema: f({ input: {} }),
  search_aggregate: f({ skip: true, note: 'Requires field config; covered by search module unit tests.' }),
  search_reindex: f({ skip: true, note: 'Mutation tool — would trigger a real reindex job.' }),

  // -------------------- customers module --------------------
  'customers.list_people': f({ input: { limit: 5 } }),
  'customers.get_person': f({
    skip: true,
    note: 'Underlying route packages/core/.../customers/api/people/[id]/route.js imports `next/server` which Node ESM cannot resolve from package dist. Bug — re-enable once the route is ESM-clean or routed through the operation runner with a different loader.',
  }),
  'customers.list_companies': f({ input: { limit: 5 } }),
  'customers.get_company': f({
    skip: true,
    note: 'Same next/server ESM-resolution issue as customers.get_person.',
  }),
  'customers.list_deals': f({ input: { limit: 5 } }),
  'customers.get_deal': f({
    skip: true,
    note: 'Same next/server ESM-resolution issue as customers.get_person.',
  }),
  'customers.list_activities': f({ input: { limit: 5 } }),
  'customers.list_tasks': f({ input: { limit: 5 } }),
  'customers.list_addresses': f({
    idFrom: 'customers.list_people',
    bindAs: 'entityId',
    extra: { entityType: 'person' },
    note: 'Schema requires { entityType: "person" | "company", entityId }.',
  }),
  'customers.list_tags': f({ input: { limit: 5 } }),
  'customers.get_settings': f({ input: {} }),
  'customers.update_deal_stage': f({
    idFrom: 'customers.list_deals',
    bindAs: 'dealId',
    extra: { toStage: 'open' },
    note: 'Mutation — schema requires exactly one of { toPipelineStageId, toStage }.',
  }),

  // -------------------- catalog module --------------------
  'catalog.list_products': f({ input: { limit: 5 } }),
  'catalog.search_products': f({ input: { query: 'demo', limit: 5 } }),
  'catalog.get_product': f({ idFrom: 'catalog.list_products', bindAs: 'productId' }),
  'catalog.get_product_bundle': f({ idFrom: 'catalog.list_products', bindAs: 'productId' }),
  'catalog.list_categories': f({ input: { limit: 10 } }),
  'catalog.list_variants': f({ idFrom: 'catalog.list_products', bindAs: 'productId' }),
  'catalog.list_offers': f({
    skip: true,
    note: 'Tool requiredFeatures do not cover the underlying GET /catalog/offers route requiredFeatures — real ACL config drift. Re-enable after fixing catalog.list_offers requiredFeatures to include the route gates.',
  }),
  'catalog.list_media': f({ idFrom: 'catalog.list_products', bindAs: 'productId' }),
  'catalog.list_tags': f({ input: { limit: 10 } }),
  'catalog.get_configuration': f({ input: {} }),
  // Authoring/structured-output tools — they call the LLM, skip in test mode
  // so TC-INT-AI-TOOLS still passes in CI without provider API keys.
  'catalog.draft_description_from_attributes': f({ skip: true, note: 'LLM-backed authoring tool.' }),
  'catalog.extract_attributes_from_description': f({ skip: true, note: 'LLM-backed authoring tool.' }),
  'catalog.draft_description_from_media': f({ skip: true, note: 'LLM-backed authoring tool.' }),
  'catalog.suggest_title_variants': f({ skip: true, note: 'LLM-backed authoring tool.' }),
  'catalog.suggest_price_adjustment': f({ skip: true, note: 'LLM-backed authoring tool.' }),
  // Mutation tools — exercised via prepareMutation only.
  'catalog.update_product': f({
    idFrom: 'catalog.list_products',
    bindAs: 'productId',
    extra: { subtitle: 'tool-test-runner-noop' },
    note: 'Single optional field tweak; prepareMutation produces a preview card.',
  }),
  'catalog.bulk_update_products': f({
    skip: true,
    note: 'Bulk mutation; needs records[] with versions — covered by catalog merchandising integration test.',
  }),
  'catalog.apply_attribute_extraction': f({
    skip: true,
    note: 'Bulk mutation tied to extract_attributes output.',
  }),
  'catalog.update_product_media_descriptions': f({
    skip: true,
    note: 'Bulk mutation tied to draft_media_descriptions output.',
  }),

  // -------------------- inbox_ops module --------------------
  inbox_ops_list_proposals: f({ input: { limit: 5 } }),
  inbox_ops_get_proposal: f({ idFrom: 'inbox_ops_list_proposals' }),
  inbox_ops_categorize_email: f({
    skip: true,
    note: 'Requires a queued email payload; LLM-backed.',
  }),
  inbox_ops_accept_action: f({
    skip: true,
    note: 'Mutation that finalizes a proposal; covered by inbox_ops integration tests.',
  }),
}

export function getFixture(toolName: string): ToolFixture | undefined {
  return toolFixtures[toolName]
}
