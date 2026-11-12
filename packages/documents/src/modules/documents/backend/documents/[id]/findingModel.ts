import { z } from 'zod'
import { findingTextMatches } from '../../../lib/findingTextNormalization'

export const FINDING_SEVERITIES = ['blocking', 'warning', 'info'] as const

export type FindingSeverity = typeof FINDING_SEVERITIES[number]

export type FindingSeverityCounts = Record<FindingSeverity, number>

const severitySchema = z.enum(FINDING_SEVERITIES)

const findingAnchorSchema = z.object({
  version: z.literal(2),
  relativeFrom: z.string().min(1),
  relativeTo: z.string().min(1),
})

export const documentFindingItemSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  source: z.string(),
  sourceWorkflowInstanceId: z.string().nullable().default(null),
  sourceAgentRunId: z.string().nullable().default(null),
  playbookId: z.string().nullable().default(null),
  playbookVersion: z.number().int().nullable().default(null),
  ruleId: z.string().nullable().default(null),
  ruleCode: z.string().nullable().default(null),
  severity: severitySchema,
  title: z.string(),
  explanation: z.string(),
  sectionLabel: z.string().nullable().default(null),
  quote: z.string(),
  occurrence: z.number().int().min(1).default(1),
  suggestedText: z.string().nullable().default(null),
  anchor: findingAnchorSchema.nullable().default(null),
  anchorStatus: z.enum(['located', 'unlocated']),
  status: z.enum(['open', 'applied', 'kept', 'superseded']),
  appliedText: z.string().nullable().default(null),
  decisionNote: z.string().nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DocumentFindingItem = z.infer<typeof documentFindingItemSchema>
export type FindingAnchor = z.infer<typeof findingAnchorSchema>

const severityCountsSchema = z.object({
  blocking: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
})

export const findingReviewPlaybookSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  version: z.number().int().nullable(),
})

export type FindingReviewPlaybook = z.infer<typeof findingReviewPlaybookSchema>

export const findingSummarySchema = z.object({
  reviewId: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  playbook: findingReviewPlaybookSchema.nullable().default(null),
  open: severityCountsSchema,
  decided: z.object({
    applied: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
  }),
  unlocated: z.number().int().nonnegative(),
})

export type FindingSummary = z.infer<typeof findingSummarySchema>

const findingListSchema = z.object({
  items: z.array(z.unknown()),
  reviewId: z.string().nullable().optional(),
})

export function normalizeFinding(value: unknown): DocumentFindingItem | null {
  const parsed = documentFindingItemSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function normalizeFindingList(value: unknown): DocumentFindingItem[] {
  const parsed = findingListSchema.safeParse(value)
  if (!parsed.success) return []
  return parsed.data.items.flatMap((item) => {
    const finding = normalizeFinding(item)
    return finding ? [finding] : []
  })
}

export function normalizeFindingSummary(value: unknown): FindingSummary | null {
  const parsed = findingSummarySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function openFindingTotal(summary: FindingSummary | null): number {
  if (!summary) return 0
  return summary.open.blocking + summary.open.warning + summary.open.info
}

export type FindingGroups = Record<FindingSeverity, DocumentFindingItem[]> & { decided: DocumentFindingItem[] }

export function groupFindings(findings: DocumentFindingItem[]): FindingGroups {
  const groups: FindingGroups = { blocking: [], warning: [], info: [], decided: [] }
  for (const finding of findings) {
    if (finding.status === 'superseded') continue
    if (finding.status === 'open') groups[finding.severity].push(finding)
    else groups.decided.push(finding)
  }
  return groups
}

export function countDistinctSections(findings: DocumentFindingItem[]): number {
  const labels = new Set<string>()
  for (const finding of findings) {
    const label = finding.sectionLabel?.trim()
    if (label) labels.add(label.toLocaleLowerCase())
  }
  return labels.size
}

export type FindingRange = { from: number; to: number }

export type FindingResolution =
  | { kind: 'unlocated' }
  | { kind: 'missing' }
  | { kind: 'located'; from: number; to: number; matches: boolean }

export type FindingDecorationRange = {
  id: string
  severity: FindingSeverity
  from: number
  to: number
}

export type FindingResolutionResult = {
  resolutions: Record<string, FindingResolution>
  ranges: FindingDecorationRange[]
}

export type FindingRangeLocators = {
  resolveAnchor: ((anchor: FindingAnchor) => FindingRange | null) | null
  locateQuote: (request: { quote: string; occurrence: number; sectionLabel: string | null }) => FindingRange | null
}

export function locateFindingRange(finding: DocumentFindingItem, locators: FindingRangeLocators): FindingRange | null {
  if (locators.resolveAnchor) return finding.anchor ? locators.resolveAnchor(finding.anchor) : null
  return locators.locateQuote({
    quote: finding.quote,
    occurrence: finding.occurrence,
    sectionLabel: finding.sectionLabel,
  })
}

export function resolveFindingRanges(
  findings: DocumentFindingItem[],
  resolveRange: (finding: DocumentFindingItem) => FindingRange | null,
  readText: (range: FindingRange) => string,
): FindingResolutionResult {
  const resolutions: Record<string, FindingResolution> = {}
  const ranges: FindingDecorationRange[] = []
  for (const finding of findings) {
    if (finding.status === 'superseded') continue
    if (finding.anchorStatus === 'unlocated') {
      resolutions[finding.id] = { kind: 'unlocated' }
      continue
    }
    const range = resolveRange(finding)
    if (!range || range.from >= range.to) {
      resolutions[finding.id] = { kind: 'missing' }
      continue
    }
    const matches = findingTextMatches(readText(range), finding.quote)
    resolutions[finding.id] = { kind: 'located', from: range.from, to: range.to, matches }
    if (finding.status === 'open') {
      ranges.push({ id: finding.id, severity: finding.severity, from: range.from, to: range.to })
    }
  }
  ranges.sort((left, right) => left.from - right.from || left.to - right.to)
  return { resolutions, ranges }
}

export function canApplyFinding(finding: DocumentFindingItem, resolution: FindingResolution | undefined): boolean {
  return finding.status === 'open'
    && finding.suggestedText !== null
    && resolution?.kind === 'located'
    && resolution.matches
}

export function emptySeverityCounts(): FindingSeverityCounts {
  return { blocking: 0, warning: 0, info: 0 }
}

export function countFindingsByHeading(
  headingPositions: number[],
  ranges: Array<Pick<FindingDecorationRange, 'from' | 'severity'>>,
): Map<number, FindingSeverityCounts> {
  const sorted = [...headingPositions].sort((left, right) => left - right)
  const counts = new Map<number, FindingSeverityCounts>()
  for (const range of ranges) {
    let owner: number | null = null
    let low = 0
    let high = sorted.length - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const position = sorted[middle] ?? Number.POSITIVE_INFINITY
      if (position <= range.from) {
        owner = position
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (owner === null) continue
    const current = counts.get(owner) ?? emptySeverityCounts()
    current[range.severity] += 1
    counts.set(owner, current)
  }
  return counts
}

export function severityDots(counts: FindingSeverityCounts | undefined, limit = 2): FindingSeverity[] {
  if (!counts) return []
  return FINDING_SEVERITIES.filter((severity) => counts[severity] > 0).slice(0, limit)
}
