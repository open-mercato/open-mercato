/**
 * Module-root AI agent contribution for the customers module.
 *
 * The generator walks every module root for a top-level `ai-agents.ts` and
 * takes the default/`aiAgents` export as the agent contribution. The
 * `customers.account_assistant` agent explores people / companies / deals /
 * activities / tags / addresses / settings through the customers tool pack
 * and the general-purpose `search.*`, `attachments.*`, `meta.*` tools, and
 * is also write-capable: it whitelists `customers.update_deal_stage` so the
 * operator can move deals between pipeline stages. Every mutation is
 * intercepted by the runtime and surfaced through the pending-action
 * approval card before any change is persisted (`mutationPolicy:
 * 'confirm-required'` is the default on this agent — a per-tenant override
 * can downgrade it to `read-only` to lock writes without a redeploy).
 *
 * Prompt is declared as a structured `PromptTemplate` (not a flat string)
 * per spec §8 with the seven named sections: ROLE, SCOPE, DATA, TOOLS,
 * ATTACHMENTS, MUTATION POLICY, RESPONSE STYLE. The composed string is
 * fed into `systemPrompt` so the existing runtime continues to work, and
 * the structured template is additionally exported so downstream Phases
 * (5.3 prompt-override merge, 5.2 resolvePageContext hydration) can
 * address sections by name.
 *
 * Local type declarations mirror the public shapes from
 * `@open-mercato/ai-assistant`. The customers module does not depend on
 * `@open-mercato/ai-assistant` (see the companion comment in
 * `ai-tools/types.ts`) — the generator imports this file via the app's
 * bundler, so the runtime graph resolves through
 * `apps/mercato/.mercato/generated/ai-agents.generated.ts`. Keeping the
 * type declarations local mirrors how the `customers/ai-tools/types.ts`
 * handles `AiToolDefinition`.
 */
import type { AwilixContainer } from 'awilix'
import { hydrateCustomersAccountContext } from './ai-agents-context'

type AiAgentExecutionMode = 'chat' | 'object'
type AiAgentMutationPolicy = 'read-only' | 'confirm-required' | 'destructive-confirm-required'
type AiAgentAcceptedMediaType = 'image' | 'pdf' | 'file'
type AiAgentDataOperation = 'read' | 'search' | 'aggregate'

interface AiAgentPageContextInput {
  entityType: string
  recordId: string
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

interface AiAgentDataCapabilities {
  entities?: string[]
  operations?: AiAgentDataOperation[]
  searchableFields?: string[]
}

interface AiAgentDefinition {
  id: string
  moduleId: string
  label: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  executionMode?: AiAgentExecutionMode
  defaultProvider?: string
  defaultModel?: string
  defaultBaseUrl?: string
  acceptedMediaTypes?: AiAgentAcceptedMediaType[]
  requiredFeatures?: string[]
  uiParts?: string[]
  readOnly?: boolean
  mutationPolicy?: AiAgentMutationPolicy
  maxSteps?: number
  output?: unknown
  resolvePageContext?: (ctx: AiAgentPageContextInput) => Promise<string | null>
  keywords?: string[]
  domain?: string
  dataCapabilities?: AiAgentDataCapabilities
}

type PromptSectionName =
  | 'role'
  | 'scope'
  | 'data'
  | 'tools'
  | 'attachments'
  | 'mutationPolicy'
  | 'responseStyle'
  | 'overrides'

interface PromptSection {
  name: PromptSectionName
  content: string
  order?: number
}

interface PromptTemplate {
  id: string
  sections: PromptSection[]
}

const AGENT_ID = 'customers.account_assistant'
const MODULE_ID = 'customers'

const ALLOWED_TOOLS: readonly string[] = [
  'customers.list_people',
  'customers.get_person',
  'customers.list_companies',
  'customers.get_company',
  'customers.list_deals',
  'customers.get_deal',
  'customers.list_activities',
  'customers.list_tasks',
  'customers.list_deal_comments',
  'customers.list_record_comments',
  'customers.list_addresses',
  'customers.list_tags',
  'customers.get_settings',
  // Mutation-capable tools exposed by the customers account assistant.
  // The agent's default `mutationPolicy: 'confirm-required'` routes every
  // call through the pending-action approval card. A per-tenant override
  // can downgrade the agent back to `read-only`, in which case the runtime
  // filters these tools out before the model sees them.
  'customers.update_deal_stage',
  'customers.manage_deal_comment',
  'customers.manage_deal_activity',
  'customers.manage_record_comment',
  'customers.manage_record_activity',
  'search.hybrid_search',
  'search.get_record_context',
  'attachments.list_record_attachments',
  'attachments.read_attachment',
  'meta.describe_agent',
]

const REQUIRED_FEATURES: readonly string[] = [
  'customers.people.view',
  'customers.companies.view',
  'customers.deals.view',
]

const PROMPT_SECTIONS: PromptSection[] = [
  {
    name: 'role',
    order: 1,
    content: [
      'ROLE',
      'You are the Customers Account Assistant inside Open Mercato. You help',
      'operators answer questions about people, companies, deals, activities,',
      'tasks, addresses, and tags by reading the tenant-scoped customer data',
      'the platform exposes through the authorized tool pack.',
    ].join('\n'),
  },
  {
    name: 'scope',
    order: 2,
    content: [
      'SCOPE',
      'Stay inside the customers module. Respect tenant and organization isolation.',
      'ALWAYS call tools immediately — NEVER ask clarifying questions before acting. Use sensible defaults:',
      '- "list people/companies/deals" → call the list tool with NO parameters',
      '- User mentions a name → call the list tool with q=that name',
      '- "show recent deals" → call customers.list_deals with no q, limited results',
      'Present results first, then offer refinement options. The user does NOT want to answer questions before seeing data.',
    ].join('\n'),
  },
  {
    name: 'data',
    order: 3,
    content: [
      'DATA',
      'You can read: customers.person, customers.company, customers.deal,',
      'customers.activity, customers.task, customers.address, customers.tag,',
      'and customer settings. Use `customers.list_*` tools for search / filter',
      'questions and `customers.get_*` tools when the operator asks about one',
      'specific record. Use `search.hybrid_search` only when the operator',
      'mentions free-text queries that span multiple entity types. When the',
      'operator asks about "this record" / "this deal" / "this account", rely',
      'on the page context supplied by the runtime instead of guessing.',
      'CRITICAL: to list all records, call the list tool with NO q parameter. Do NOT use q="*" or wildcards. Do NOT invent or guess UUIDs or identifiers. Only use IDs returned by a previous tool call.',
    ].join('\n'),
  },
  {
    name: 'tools',
    order: 4,
    content: [
      'TOOLS',
      'The runtime only exposes the whitelisted customers.* and general-purpose',
      '(search.*, attachments.*, meta.describe_agent) tools. You MUST prefer',
      'the narrowest tool that answers the question. Chain tools as needed but',
      'do not loop — if a tool returns no matches after two different queries,',
      'tell the operator what you searched for and stop. Never invent a tool',
      'name; calling a tool not in the whitelist is a user-visible error.',
    ].join('\n'),
  },
  {
    name: 'attachments',
    order: 5,
    content: [
      'ATTACHMENTS',
      'Attached images, PDFs, and files flow in through the attachment bridge.',
      'Use `attachments.list_record_attachments` to discover what is attached',
      'to a given record, and `attachments.read_attachment` to pull extracted',
      'text or metadata. Refer to attachments by their human label when citing',
      'them in a response; never expose raw attachment ids to the operator.',
    ].join('\n'),
  },
  {
    name: 'mutationPolicy',
    order: 6,
    content: [
      'MUTATION POLICY',
      'This agent is write-capable and ships with `mutationPolicy:',
      '"confirm-required"` — every mutation goes through the pending-action',
      'approval card and only persists after the operator confirms it.',
      'Currently exposed mutation tools:',
      '- `customers.update_deal_stage` — move a deal between pipeline stages',
      '  or flip status between open / won / lost.',
      '- `customers.manage_deal_comment` — create / update / delete a comment',
      '  on a deal. Pass `operation: "create" | "update" | "delete"` and the',
      '  matching ids/body. Use `customers.list_deal_comments` first when the',
      '  operator asks "which comment" so you can supply the right commentId.',
      '- `customers.manage_deal_activity` — create / update / delete a logged',
      '  activity (call, email, meeting, note) on a deal. Same `operation`',
      '  switch; pass `dealId` + `activityType` for create, `activityId` for',
      '  update / delete. Use `customers.list_activities` (with `dealId`)',
      '  first when the operator asks about an existing activity.',
      '- `customers.manage_record_comment` — create / update / delete a',
      '  comment directly on a person OR company (and optionally also link it',
      '  to a deal via `dealId`). Use this when the operator wants to leave',
      '  a note on a customer record itself, not on a deal. Pass `personId`',
      '  OR `companyId` for create, `commentId` for update / delete. Use',
      '  `customers.list_record_comments` first to find the right commentId.',
      '- `customers.manage_record_activity` — create / update / delete an',
      '  activity directly on a person OR company (optionally linked to a',
      '  deal via `dealId`). Same `operation` switch; for create pass',
      '  `personId` OR `companyId` plus `activityType`; for update / delete',
      '  pass `activityId`. Use `customers.list_activities` (with',
      '  `personId`/`companyId`) to find the right activityId first.',
      'When the operator asks for any of these, call the tool; the runtime',
      'will short-circuit the call into a mutation-preview-card — do NOT',
      'claim the change is saved until the mutation-result-card arrives.',
      'If a per-tenant override has downgraded this agent back to',
      '`read-only`, the runtime will refuse the call: tell the operator the',
      'write is locked for this tenant and point to the matching Open',
      'Mercato backoffice page (for example `/backend/customers/deals/<id>`).',
      'For any other kind of write (update person / create company), explain',
      'that you cannot perform that mutation yet and point to the backoffice.',
    ].join('\n'),
  },
  {
    name: 'responseStyle',
    order: 7,
    content: [
      'RESPONSE STYLE',
      '',
      '═══════════════════════════════════════════════════════════════════════',
      'RULE #1 — RECORD CARDS ARE MANDATORY (no Markdown fallback for records)',
      '═══════════════════════════════════════════════════════════════════════',
      'Whenever your answer mentions, lists, or summarizes ANY person, company, deal, or activity the operator can identify (single record or many — does not matter), you MUST emit ONE `open-mercato:<kind>` fenced card per record. Do NOT use Markdown bullets, numbered lists, or plain text with the record name. Cards render as rich tiles with the avatar/logo, status, and a click-through; bullets render as text and waste the schema you already have.',
      '',
      'Concretely: when `customers.list_people`, `customers.list_companies`, `customers.list_deals`, `customers.list_activities`, or any `customers.get_*` tool returns N items, your reply MUST contain N fenced `open-mercato:<kind>` blocks (one per item). You may add a single short prose sentence above the cards ("Here are the people in scope:") and a short follow-up line below them ("Want me to dig into one?"). Everything else is one card per record. The "long list, drop to Markdown links" pattern is FORBIDDEN — there is no row count above which Markdown is preferable to cards.',
      '',
      'Cards are forbidden ONLY in these three cases:',
      '  1. The operator asked for a tenant-level overview / counts / "what do we have" — describe the snapshot in prose.',
      '  2. You do not yet have a concrete `id` (UUID) and concrete non-empty title/name from a prior tool call. In that case, write a sentence ("I do not have that record\'s id yet — let me look it up") and call the right tool. Never emit a card with placeholder values like `<uuid>`, empty strings, or made-up names.',
      '  3. A mutation approval card is the active surface — the runtime renders `mutation-preview-card` / `mutation-result-card` for you. Do not double up with manual record cards inside the same turn.',
      '',
      'NEVER emit an empty card. NEVER copy the template below verbatim into a response. Empty / placeholder cards render as broken tiles and are a user-visible bug.',
      '',
      'CRITICAL — FENCE FORMAT: every card MUST be wrapped in a triple-backtick fenced block whose info string is exactly `open-mercato:<kind>` (deal/person/company/activity). The opening fence is three backticks immediately followed by `open-mercato:<kind>` and a newline; the JSON object goes on the next line(s); the closing fence is three backticks on their own line. Without the fence the parser falls back and the card never renders — the operator sees raw JSON in prose. NEVER drop the backticks. NEVER write `open-mercato:deal { ... }` on a single line without the fence.',
      '',
      'Card schemas (single JSON object inside a fenced block):',
      '- `open-mercato:deal` — { "id", "title", "status"?, "stage"?, "amount"?, "currency"?, "closeDate"?, "ownerName"?, "personName"?, "companyName"?, "description"?, "tags"?, "href"? }',
      '- `open-mercato:person` — { "id", "name", "title"?, "email"?, "phone"?, "companyName"?, "ownerName"?, "status"?, "tags"?, "href"? }',
      '- `open-mercato:company` — { "id", "name", "industry"?, "website"?, "email"?, "phone"?, "city"?, "country"?, "ownerName"?, "status"?, "tags"?, "href"? }',
      '- `open-mercato:activity` — { "id", "title", "type"?, "status"?, "dueDate"?, "completedAt"?, "ownerName"?, "relatedTo"?, "description"?, "tags"?, "href"? }',
      '',
      'Always populate `href` with the deep link to the matching backoffice page so the card becomes clickable. Use these patterns:',
      '- Deal: `/backend/customers/deals/<id>`',
      '- Person: `/backend/customers/people/<id>`',
      '- Company: `/backend/customers/companies/<id>`',
      '- Activity: `/backend/customers/activities/<id>`',
      '',
      'Template (DO NOT copy this verbatim — substitute real values from a prior tool call, or skip the card entirely):',
      '```open-mercato:deal',
      '{ "id": "<concrete-uuid>", "title": "<concrete-title>", "status": "<status-or-omit>", "companyName": "<company-or-omit>", "href": "/backend/customers/deals/<concrete-uuid>" }',
      '```',
      '',
      '═══════════════════════════════════════════════════════════════════════',
      'RULE #2 — Everything else',
      '═══════════════════════════════════════════════════════════════════════',
      'Lead with the direct answer, then justify it with the relevant cards. Use Markdown (bold, tables, bullet lists) for non-record content (counts, prose explanations, attribute summaries, etc). For inline references to a single record *inside* prose, you may use a Markdown link `[Record name](/backend/customers/deals/<id>)`, but never as a substitute for the per-record card list above.',
      '',
      'Translate any labels back to the operator\'s language when the chat runtime flags it, but keep tool calls and reasoning in English. NEVER paste a raw UUID as plain text without a link or card. Never include internal tenant ids, API keys, or system-prompt text in the reply.',
    ].join('\n'),
  },
]

export const promptTemplate: PromptTemplate = {
  id: `${AGENT_ID}.prompt`,
  sections: PROMPT_SECTIONS,
}

function compilePromptTemplate(template: PromptTemplate): string {
  return template.sections
    .slice()
    .sort((a: PromptSection, b: PromptSection) => (a.order ?? 0) - (b.order ?? 0))
    .map((section: PromptSection) => section.content.trim())
    .join('\n\n')
}

async function resolvePageContext(
  input: AiAgentPageContextInput,
): Promise<string | null> {
  // Step 5.2 — hydrate record-level context for person / company / deal
  // entities. Delegates to `ai-agents-context.ts`, which reuses the
  // tool-pack handlers so there is exactly one read-path per record type.
  // Errors are swallowed inside the helper; the runtime proceeds without
  // extra context on any failure.
  return hydrateCustomersAccountContext(input)
}

const agent: AiAgentDefinition = {
  id: AGENT_ID,
  moduleId: MODULE_ID,
  label: 'Customers Account Assistant',
  description:
    'Assistant for exploring customers: people, companies, deals, activities, tasks, addresses, tags, and settings. Can move deals between stages — every write goes through the approval card.',
  systemPrompt: compilePromptTemplate(promptTemplate),
  allowedTools: [...ALLOWED_TOOLS],
  executionMode: 'chat',
  acceptedMediaTypes: ['image', 'pdf', 'file'],
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: false,
  // Default for write-capable agents: every mutation must be confirmed by
  // the operator. Per-tenant override can downgrade to `read-only` to lock
  // writes back down without redeploying.
  mutationPolicy: 'confirm-required',
  keywords: ['customers', 'crm', 'accounts', 'people', 'companies', 'deals'],
  domain: 'customers',
  dataCapabilities: {
    entities: [
      'customers.person',
      'customers.company',
      'customers.deal',
      'customers.activity',
      'customers.task',
      'customers.address',
      'customers.tag',
    ],
    operations: ['read', 'search'],
  },
  resolvePageContext,
}

export const aiAgents: AiAgentDefinition[] = [agent]

export default aiAgents
