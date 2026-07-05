import { computeHeaderRollups } from './stateMachine'
import type { WarrantyClaimLineStatus } from '../data/validators'

type AmountValue = number | string | null | undefined

export type VendorRecoveryClaimInput = {
  id: string
  claimType?: string | null
  status?: string | null
  reasonCode?: string | null
}

export type VendorRecoveryLineInput = {
  id: string
  vendorName?: string | null
  lineStatus?: WarrantyClaimLineStatus | null
  vendorClaimLineId?: string | null
  faultCode?: string | null
  creditAmount?: AmountValue
  credit_amount?: AmountValue
  restockingFee?: AmountValue
  restocking_fee?: AmountValue
  coreCreditAmount?: AmountValue
  core_credit_amount?: AmountValue
}

export type VendorPolicyRecoveryInput = {
  id: string
  vendorName: string
  vendorRef?: string | null
  claimableReasonCodes?: readonly string[] | null
  recoveryRatePct?: number | string | null
  autoGenerateRecovery?: boolean | null
  isActive?: boolean | null
}

export type VendorRecoveryMatch = {
  line: VendorRecoveryLineInput
  policy: VendorPolicyRecoveryInput
  estimatedRecovery: string | null
  causalFault: string | null
}

export type VendorRecoveryCommandRequest = {
  claimId: string
  vendorName: string
  vendorRef: string | null
  lineIds: string[]
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeVendorKey(value: string | null | undefined): string | null {
  return normalizeText(value)?.toLocaleLowerCase() ?? null
}

function normalizeReasonCodes(codes: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(codes)) return []
  const result: string[] = []
  for (const code of codes) {
    const normalized = normalizeText(code)
    if (normalized && !result.includes(normalized)) result.push(normalized)
  }
  return result
}

function reasonMatchesPolicy(policy: VendorPolicyRecoveryInput, reasonCode: string | null): boolean {
  const claimableReasonCodes = normalizeReasonCodes(policy.claimableReasonCodes)
  if (!claimableReasonCodes.length) return true
  if (!reasonCode) return false
  return claimableReasonCodes.includes(reasonCode)
}

function reasonMatchRank(policy: VendorPolicyRecoveryInput, reasonCode: string | null): number {
  const claimableReasonCodes = normalizeReasonCodes(policy.claimableReasonCodes)
  if (reasonCode && claimableReasonCodes.includes(reasonCode)) return 0
  return claimableReasonCodes.length ? 2 : 1
}

function parseRecoveryRatePct(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '0.00'
  return (Math.round(value * 100) / 100).toFixed(2)
}

function estimateRecovery(line: VendorRecoveryLineInput, policy: VendorPolicyRecoveryInput): string | null {
  const rate = parseRecoveryRatePct(policy.recoveryRatePct)
  if (rate === null) return null
  const approvedAmount = computeHeaderRollups([line]).totalApprovedAmount
  return formatMoney(approvedAmount * (rate / 100))
}

function selectMatchingPolicy(
  line: VendorRecoveryLineInput,
  policies: readonly VendorPolicyRecoveryInput[],
  reasonCode: string | null,
  autoOnly: boolean,
): VendorPolicyRecoveryInput | null {
  const vendorKey = normalizeVendorKey(line.vendorName)
  if (!vendorKey) return null
  const candidates = policies
    .filter((policy) => policy.isActive !== false)
    .filter((policy) => !autoOnly || policy.autoGenerateRecovery === true)
    .filter((policy) => normalizeVendorKey(policy.vendorName) === vendorKey)
    .filter((policy) => reasonMatchesPolicy(policy, reasonCode))
    .sort((left, right) => reasonMatchRank(left, reasonCode) - reasonMatchRank(right, reasonCode))
  return candidates[0] ?? null
}

export function isWarrantyClaimResolvedForVendorRecovery(claim: VendorRecoveryClaimInput): boolean {
  return claim.claimType === 'warranty' && (claim.status === 'resolved' || claim.status === 'closed')
}

export function findVendorRecoveryMatches(input: {
  claim: VendorRecoveryClaimInput
  lines: readonly VendorRecoveryLineInput[]
  policies: readonly VendorPolicyRecoveryInput[]
  autoOnly?: boolean
  requireWarrantyResolved?: boolean
}): VendorRecoveryMatch[] {
  if (input.requireWarrantyResolved === true && !isWarrantyClaimResolvedForVendorRecovery(input.claim)) {
    return []
  }
  const reasonCode = normalizeText(input.claim.reasonCode)
  const matches: VendorRecoveryMatch[] = []
  for (const line of input.lines) {
    if (line.lineStatus !== 'resolved') continue
    if (normalizeText(line.vendorClaimLineId)) continue
    const policy = selectMatchingPolicy(line, input.policies, reasonCode, input.autoOnly === true)
    if (!policy) continue
    matches.push({
      line,
      policy,
      estimatedRecovery: estimateRecovery(line, policy),
      causalFault: normalizeText(line.faultCode) ?? reasonCode,
    })
  }
  return matches
}

export function buildVendorRecoveryCommandRequests(
  claimId: string,
  matches: readonly VendorRecoveryMatch[],
): VendorRecoveryCommandRequest[] {
  const grouped = new Map<string, VendorRecoveryCommandRequest>()
  for (const match of matches) {
    const vendorName = normalizeText(match.policy.vendorName) ?? normalizeText(match.line.vendorName)
    if (!vendorName) continue
    const vendorRef = normalizeText(match.policy.vendorRef)
    const key = `${match.policy.id}:${vendorName}:${vendorRef ?? ''}`
    const existing = grouped.get(key)
    if (existing) {
      existing.lineIds.push(match.line.id)
      continue
    }
    grouped.set(key, {
      claimId,
      vendorName,
      vendorRef,
      lineIds: [match.line.id],
    })
  }
  return Array.from(grouped.values())
}
