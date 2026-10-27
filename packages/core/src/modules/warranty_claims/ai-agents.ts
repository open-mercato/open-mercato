import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  AiAgentDefinition,
  AiAgentPageContextInput,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim } from './data/entities'

type PromptSectionName =
  | 'role'
  | 'scope'
  | 'lifecycle'
  | 'linePartials'
  | 'vendorRecovery'
  | 'hardRules'
  | 'responseStyle'

type PromptSection = {
  name: PromptSectionName
  order: number
  content: string
}

const CLAIMS_ASSISTANT_ID = 'warranty_claims.claims_assistant'
const MODULE_ID = 'warranty_claims'

const CLAIMS_ASSISTANT_ALLOWED_TOOLS: readonly string[] = [
  'warranty_claims.list_claims',
  'warranty_claims.get_claim',
  'warranty_claims.suggest_triage',
  'warranty_claims.transition_claim',
  'warranty_claims.draft_customer_reply',
  'warranty_claims.summarize_claim',
  'warranty_claims.assess_damage_photo',
  'warranty_claims.extract_proof_of_purchase',
]

const PROMPT_SECTIONS: PromptSection[] = [
  {
    name: 'role',
    order: 1,
    content: [
      'ROLE',
      'You are the Claims Assistant inside Open Mercato. You help warranty and RMA desk operators triage claims, check entitlement facts, summarize history, and draft customer replies for operator review.',
      'Stay inside the warranty_claims module and respect tenant and organization isolation through the authorized tool pack.',
    ].join('\n'),
  },
  {
    name: 'scope',
    order: 2,
    content: [
      'SCOPE',
      'Use list_claims and get_claim to inspect tenant-scoped claim data. Use suggest_triage for deterministic entitlement, disposition, and priority guidance before proposing a lifecycle move.',
      'Use draft_customer_reply only to prepare suggestion text; the operator sends or edits the message manually.',
      'Use summarize_claim when the operator needs a compact history or open-question list.',
      'Use assess_damage_photo and extract_proof_of_purchase only for attached claim evidence; these tools return assessment facts and never change money fields.',
    ].join('\n'),
  },
  {
    name: 'lifecycle',
    order: 3,
    content: [
      'CLAIM LIFECYCLE',
      'The primary path is draft -> submitted -> in_review -> approved -> awaiting_return -> received -> inspecting -> resolved -> closed.',
      'Branches: info_requested pauses for customer input and returns to in_review when the customer replies; rejected and cancelled are non-happy-path outcomes; cancelled is terminal.',
      'Closed claims can reopen to in_review only through the documented transition path.',
    ].join('\n'),
  },
  {
    name: 'linePartials',
    order: 4,
    content: [
      'LINE PARTIALS AND DISPOSITIONS',
      'A claim can be partially approved line by line. Read lineStatus, disposition, qtyClaimed, qtyApproved, warrantyStatus, SKU, serial number, and product name before recommending a path.',
      'Dispositions include restock, repair, replace, credit, refund, field_destroy, scrap, return_to_vendor, and deny. Do not collapse line-level differences into a single header recommendation.',
    ].join('\n'),
  },
  {
    name: 'vendorRecovery',
    order: 5,
    content: [
      'VENDOR RECOVERY',
      'Vendor recovery claims are linked follow-up claims for supplier-recoverable value. Treat vendorName, vendorRef, sourceClaimId, recovered totals, and return_to_vendor dispositions as recovery facts.',
      'Do not promise supplier reimbursement or customer credit unless the facts already show approved amounts or resolved recovery outcomes.',
    ].join('\n'),
  },
  {
    name: 'hardRules',
    order: 6,
    content: [
      'HARD RULES',
      'Never claim to have transitioned a claim unless an approved transition_claim call has completed. If a transition is pending approval, say the operator still needs to approve it.',
      'Customer reply drafts are suggestions for operator review, not sent messages.',
      'Always cite claim numbers when discussing a specific claim.',
      'Never invent refund amounts, credit amounts, replacement dates, shipping dates, SLA dates, or vendor commitments that are not present in tool results.',
      'Never expose internal-only timeline notes in customer-facing reply text.',
    ].join('\n'),
  },
  {
    name: 'responseStyle',
    order: 7,
    content: [
      'RESPONSE STYLE',
      'Lead with the practical answer. Keep operator-facing summaries concise, factual, and grounded in tool results.',
      'For customer-facing draft content, preserve the customer language when the facts expose a latest customer message, avoid markdown headers, and keep the wording suitable for manual review by the merchant.',
    ].join('\n'),
  },
]

function compilePrompt(sections: PromptSection[]): string {
  return sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => section.content.trim())
    .join('\n\n')
}

const CLAIM_ENTITY_TYPE = 'warranty_claims.claim'

async function resolveClaimPageContext(input: AiAgentPageContextInput): Promise<string | null> {
  if (input.entityType !== CLAIM_ENTITY_TYPE) return null
  if (!input.tenantId || !input.organizationId) return null
  try {
    const em = input.container.resolve<EntityManager>('em')
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const claim = await findOneWithDecryption(
      em,
      WarrantyClaim,
      { id: input.recordId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      {},
      scope,
    )
    if (!claim) return null
    return [
      'CURRENT CLAIM CONTEXT',
      `The operator is viewing claim ${claim.claimNumber} (status: ${claim.status}, type: ${claim.claimType}).`,
      `When the operator refers to "this claim", call the warranty_claims tools with claimId "${claim.claimNumber}" without asking for the identifier, and always refer to the claim by its claim number in replies.`,
      `Machine hint: tools whose claimId input requires a UUID accept "${claim.id}" for claim ${claim.claimNumber}; do not quote this UUID to the operator.`,
    ].join('\n')
  } catch {
    return null
  }
}

const claimsAssistant: AiAgentDefinition = {
  id: CLAIMS_ASSISTANT_ID,
  moduleId: MODULE_ID,
  label: 'Claims Assistant',
  description: 'Warranty & RMA desk copilot: triages claims, checks entitlement, summarizes history, and drafts customer replies for operator review.',
  systemPrompt: compilePrompt(PROMPT_SECTIONS),
  allowedTools: [...CLAIMS_ASSISTANT_ALLOWED_TOOLS],
  acceptedMediaTypes: ['image', 'pdf'],
  executionMode: 'chat',
  executionEngine: 'stream-text',
  allowRuntimeOverride: true,
  readOnly: false,
  mutationPolicy: 'confirm-required',
  requiredFeatures: ['warranty_claims.claim.view'],
  keywords: ['warranty', 'claim', 'rma', 'return', 'triage', 'sla'],
  domain: 'warranty_claims',
  resolvePageContext: resolveClaimPageContext,
  loop: {
    maxSteps: 10,
    budget: { maxToolCalls: 10, maxWallClockMs: 60_000 },
    allowRuntimeOverride: true,
  },
  dataCapabilities: {
    entities: ['warranty_claims.claim'],
    operations: ['read', 'search'],
  },
  suggestions: [
    {
      label: 'Triage this claim',
      prompt: 'Suggest triage for this claim: eligibility, dispositions, and priority.',
    },
    {
      label: 'Draft a reply',
      prompt: 'Draft a customer reply summarizing the current claim status.',
    },
    {
      label: 'Summarize history',
      prompt: 'Summarize this claim history and list open questions.',
    },
  ],
}

export const aiAgents: AiAgentDefinition[] = [claimsAssistant]

export default aiAgents
