import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export const quoteApprovalRequirementSchema = z.object({
  required: z.boolean(),
  approvalId: z.string().uuid().nullable(),
  approvalSubjectType: z.string().nullable(),
  approvalSubjectId: z.string().uuid().nullable(),
  approvalCustomerId: z.string().uuid().nullable(),
  buyerCustomerEntityId: z.string().uuid().nullable(),
  recordedAt: z.string(),
})

export type QuoteApprovalRequirement = z.infer<typeof quoteApprovalRequirementSchema>

export type QuoteApprovalClaim = { required: boolean; approvalId: string | null }

export type QuoteApprovalProofView = {
  id: string
  status: string
  currencyCode: string
  amountGross: string | number
  subjectType: string
  subjectId: string
  customerId: string
}

type QuoteApprovalProofQuote = {
  currencyCode: string
  grandTotalGrossAmount: string | number
  customerEntityId?: string | null
}

type ApprovalLookup = (approvalId: string) => Promise<QuoteApprovalProofView | null>

const PENDING_APPROVAL_METADATA_KEY = 'pendingApproval'

export function isTrustedSystemCommandContext(ctx: Pick<CommandRuntimeContext, 'auth' | 'systemActor'>): boolean {
  return ctx.systemActor === true && !ctx.auth
}

export function extractPendingApprovalClaim(metadata: Record<string, unknown> | null | undefined): QuoteApprovalClaim | null {
  const raw = metadata?.[PENDING_APPROVAL_METADATA_KEY]
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as { required?: unknown; approvalId?: unknown }
  return {
    required: candidate.required === true,
    approvalId: typeof candidate.approvalId === 'string' && candidate.approvalId.length > 0 ? candidate.approvalId : null,
  }
}

export function omitPendingApprovalMetadata<T extends Record<string, unknown> | null | undefined>(metadata: T): T {
  if (!metadata || !(PENDING_APPROVAL_METADATA_KEY in metadata)) return metadata
  const next = { ...metadata }
  delete next[PENDING_APPROVAL_METADATA_KEY]
  return next as T
}

export async function buildQuoteApprovalRequirement(input: {
  claim: QuoteApprovalClaim
  buyerCustomerEntityId: string | null
  lookupApproval: ApprovalLookup | null
  now?: Date
}): Promise<QuoteApprovalRequirement> {
  const approval = input.claim.approvalId && input.lookupApproval ? await input.lookupApproval(input.claim.approvalId) : null
  return {
    required: input.claim.required,
    approvalId: input.claim.approvalId,
    approvalSubjectType: approval?.subjectType ?? null,
    approvalSubjectId: approval?.subjectId ?? null,
    approvalCustomerId: approval?.customerId ?? null,
    buyerCustomerEntityId: input.buyerCustomerEntityId,
    recordedAt: (input.now ?? new Date()).toISOString(),
  }
}

export function parseQuoteApprovalRequirement(value: unknown): QuoteApprovalRequirement | null {
  if (value === null || value === undefined) return null
  const parsed = quoteApprovalRequirementSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type QuoteApprovalGateResult = 'not_required' | 'satisfied' | 'unsatisfied'

export async function evaluateQuoteApprovalGate(input: {
  rawRequirement: unknown
  quote: QuoteApprovalProofQuote
  lookupApproval: ApprovalLookup | null
}): Promise<QuoteApprovalGateResult> {
  if (input.rawRequirement === null || input.rawRequirement === undefined) return 'not_required'
  const requirement = parseQuoteApprovalRequirement(input.rawRequirement)
  if (!requirement) return 'unsatisfied'
  if (!requirement.required) return 'not_required'
  if (!requirement.approvalId || !input.lookupApproval) return 'unsatisfied'
  if (!requirement.approvalSubjectId || !requirement.approvalCustomerId || !requirement.buyerCustomerEntityId) return 'unsatisfied'
  if ((input.quote.customerEntityId ?? null) !== requirement.buyerCustomerEntityId) return 'unsatisfied'
  const approval = await input.lookupApproval(requirement.approvalId)
  if (!approval) return 'unsatisfied'
  const qualifies =
    approval.id === requirement.approvalId &&
    approval.status === 'approved' &&
    approval.subjectType === requirement.approvalSubjectType &&
    approval.subjectId === requirement.approvalSubjectId &&
    approval.customerId === requirement.approvalCustomerId &&
    approval.currencyCode === input.quote.currencyCode &&
    Number(approval.amountGross) >= Number(input.quote.grandTotalGrossAmount)
  return qualifies ? 'satisfied' : 'unsatisfied'
}
