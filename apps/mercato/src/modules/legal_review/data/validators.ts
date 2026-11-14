import { z } from 'zod'

export const LEGAL_MATTER_STAGES = ['requested', 'review', 'released', 'signing'] as const
export const LEGAL_AGREEMENT_TYPES = ['mutual_nda', 'one_way_nda', 'other'] as const
export const LEGAL_PAPER_SIDES = ['ours', 'counterparty'] as const

export const legalMatterStageSchema = z.enum(LEGAL_MATTER_STAGES)
export const legalAgreementTypeSchema = z.enum(LEGAL_AGREEMENT_TYPES)
export const legalPaperSchema = z.enum(LEGAL_PAPER_SIDES)

export type LegalMatterStage = z.infer<typeof legalMatterStageSchema>
export type LegalAgreementType = z.infer<typeof legalAgreementTypeSchema>
export type LegalPaper = z.infer<typeof legalPaperSchema>

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null))

const jurisdictionSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Jurisdiction must be a two-letter country code')
  .transform((value) => value.toUpperCase())
  .nullish()

const dueAtSchema = z
  .union([z.string().datetime({ offset: true }), z.date()])
  .nullish()
  .transform((value) => (value == null ? null : value instanceof Date ? value : new Date(value)))

export const legalMatterCreateSchema = z.object({
  documentId: z.string().uuid(),
  reference: z.string().trim().min(1).max(64),
  counterparty: z.string().trim().min(1).max(200),
  purpose: optionalText(500),
  jurisdiction: jurisdictionSchema,
  agreementType: legalAgreementTypeSchema.default('mutual_nda'),
  paper: legalPaperSchema.default('counterparty'),
  requestedByUserId: z.string().uuid().nullish(),
  assigneeUserId: z.string().uuid().nullish(),
  stage: legalMatterStageSchema.default('requested'),
  dueAt: dueAtSchema,
})

export const legalMatterUpdateSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().trim().min(1).max(64).optional(),
  counterparty: z.string().trim().min(1).max(200).optional(),
  purpose: optionalText(500).optional(),
  jurisdiction: jurisdictionSchema.optional(),
  agreementType: legalAgreementTypeSchema.optional(),
  paper: legalPaperSchema.optional(),
  requestedByUserId: z.string().uuid().nullish(),
  assigneeUserId: z.string().uuid().nullish(),
  stage: legalMatterStageSchema.optional(),
  dueAt: dueAtSchema.optional(),
})

export const legalMatterListQuerySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    documentId: z.string().uuid().optional(),
    stage: legalMatterStageSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

/** Input of the workflow-safe `legal_review.matter.release` command. */
export const legalMatterReleaseSchema = z.object({
  matterId: z.string().uuid(),
})

export type LegalMatterCreateInput = z.infer<typeof legalMatterCreateSchema>
export type LegalMatterUpdateInput = z.infer<typeof legalMatterUpdateSchema>
export type LegalMatterListQuery = z.infer<typeof legalMatterListQuerySchema>
export type LegalMatterReleaseInput = z.infer<typeof legalMatterReleaseSchema>

export const legalMatterItemSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  reference: z.string(),
  counterparty: z.string(),
  purpose: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  agreementType: legalAgreementTypeSchema,
  paper: legalPaperSchema,
  requestedByUserId: z.string().uuid().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  requestedByLabel: z.string().nullable(),
  assigneeLabel: z.string().nullable(),
  stage: legalMatterStageSchema,
  dueAt: z.string().nullable(),
  organizationId: z.string().uuid(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type LegalMatterItem = z.infer<typeof legalMatterItemSchema>
