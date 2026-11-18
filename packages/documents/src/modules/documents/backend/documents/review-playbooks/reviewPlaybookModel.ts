import { z } from 'zod'

export const REVIEW_PLAYBOOKS_API = '/api/documents/review-playbooks'
export const REVIEW_RULES_API = '/api/documents/review-rules'
export const REVIEW_PLAYBOOKS_PAGE_SIZE = 50
export const REVIEW_RULES_PAGE_SIZE = 100
export const REVIEW_SEVERITIES = ['blocking', 'warning', 'info'] as const

export type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

const severitySchema = z.enum(REVIEW_SEVERITIES)

export const reviewPlaybookRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  instructions: z.string().nullable().default(null),
  version: z.number().int(),
  isActive: z.boolean(),
  updatedAt: z.string().nullable().default(null),
})

export type ReviewPlaybookRow = z.infer<typeof reviewPlaybookRowSchema>

export const reviewRuleRowSchema = z.object({
  id: z.string(),
  playbookId: z.string(),
  code: z.string(),
  title: z.string(),
  topic: z.string().nullable().default(null),
  position: z.string(),
  preferredWording: z.string().nullable().default(null),
  severity: severitySchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  updatedAt: z.string().nullable().default(null),
})

export type ReviewRuleRow = z.infer<typeof reviewRuleRowSchema>

export const reviewReferenceRowSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  title: z.string().nullable(),
  accessible: z.boolean(),
  sortOrder: z.number().int(),
})

export type ReviewReferenceRow = z.infer<typeof reviewReferenceRowSchema>

const pagedListSchema = z.object({
  items: z.array(z.unknown()).default([]),
  total: z.number().optional(),
  totalPages: z.number().optional(),
  totalIsCapped: z.boolean().optional(),
})

function normalizeItems<T>(value: unknown, schema: z.ZodType<T>): T[] {
  const parsed = pagedListSchema.safeParse(value)
  if (!parsed.success) return []
  return parsed.data.items.flatMap((item) => {
    const row = schema.safeParse(item)
    return row.success ? [row.data] : []
  })
}

export function normalizeReviewPlaybookList(value: unknown): {
  rows: ReviewPlaybookRow[]
  total: number
  totalPages: number
  totalIsCapped: boolean
} {
  const rows = normalizeItems(value, reviewPlaybookRowSchema)
  const parsed = pagedListSchema.safeParse(value)
  return {
    rows,
    total: parsed.success && typeof parsed.data.total === 'number' ? parsed.data.total : rows.length,
    totalPages: parsed.success && typeof parsed.data.totalPages === 'number' && parsed.data.totalPages > 0 ? parsed.data.totalPages : 1,
    totalIsCapped: parsed.success && parsed.data.totalIsCapped === true,
  }
}

export function normalizeReviewRules(value: unknown): ReviewRuleRow[] {
  return normalizeItems(value, reviewRuleRowSchema)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))
}

export function normalizeReviewReferences(value: unknown): ReviewReferenceRow[] {
  return normalizeItems(value, reviewReferenceRowSchema)
}

export type ReviewPlaybookFormValues = {
  code: string
  name: string
  description?: string | null
  instructions?: string | null
  isActive: boolean
}

export const reviewPlaybookFormSchema = z.object({
  code: z.string().trim()
    .min(1, 'documents.reviewPlaybooks.validation.codeRequired')
    .max(64, 'documents.reviewPlaybooks.validation.codeTooLong')
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'documents.reviewPlaybooks.validation.codeFormat'),
  name: z.string().trim().min(1, 'documents.reviewPlaybooks.validation.nameRequired').max(200),
  description: z.string().max(4000).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  isActive: z.boolean(),
})

export type ReviewRuleDraft = {
  code: string
  title: string
  topic: string
  severity: ReviewSeverity
  sortOrder: string
  isActive: boolean
  position: string
  preferredWording: string
}

export const reviewRuleDraftSchema = z.object({
  code: z.string().trim()
    .min(1, 'documents.reviewPlaybooks.validation.ruleCodeRequired')
    .max(64, 'documents.reviewPlaybooks.validation.codeTooLong')
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'documents.reviewPlaybooks.validation.codeFormat'),
  title: z.string().trim().min(1, 'documents.reviewPlaybooks.validation.ruleTitleRequired').max(200),
  topic: z.string().trim().max(120),
  severity: severitySchema,
  sortOrder: z.string().trim().regex(/^\d{0,6}$/, 'documents.reviewPlaybooks.validation.sortOrder'),
  isActive: z.boolean(),
  position: z.string().trim().min(1, 'documents.reviewPlaybooks.validation.positionRequired').max(4000),
  preferredWording: z.string().trim().max(4000),
})

export function emptyRuleDraft(nextSortOrder: number): ReviewRuleDraft {
  return {
    code: '',
    title: '',
    topic: '',
    severity: 'warning',
    sortOrder: String(nextSortOrder),
    isActive: true,
    position: '',
    preferredWording: '',
  }
}

export function ruleDraftFromRow(rule: ReviewRuleRow): ReviewRuleDraft {
  return {
    code: rule.code,
    title: rule.title,
    topic: rule.topic ?? '',
    severity: rule.severity,
    sortOrder: String(rule.sortOrder),
    isActive: rule.isActive,
    position: rule.position,
    preferredWording: rule.preferredWording ?? '',
  }
}

export function ruleDraftPayload(draft: ReviewRuleDraft): Record<string, unknown> {
  const parsed = reviewRuleDraftSchema.parse(draft)
  return {
    code: parsed.code,
    title: parsed.title,
    topic: parsed.topic.length > 0 ? parsed.topic : null,
    severity: parsed.severity,
    sortOrder: parsed.sortOrder.length > 0 ? Number(parsed.sortOrder) : 0,
    isActive: parsed.isActive,
    position: parsed.position,
    preferredWording: parsed.preferredWording.length > 0 ? parsed.preferredWording : null,
  }
}

export function ruleDraftErrors(draft: ReviewRuleDraft): Partial<Record<keyof ReviewRuleDraft, string>> {
  const parsed = reviewRuleDraftSchema.safeParse(draft)
  if (parsed.success) return {}
  const errors: Partial<Record<keyof ReviewRuleDraft, string>> = {}
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) errors[key as keyof ReviewRuleDraft] = issue.message
  }
  return errors
}

export const REVIEW_SEVERITY_BADGE: Record<ReviewSeverity, 'error' | 'warning' | 'info'> = {
  blocking: 'error',
  warning: 'warning',
  info: 'info',
}
