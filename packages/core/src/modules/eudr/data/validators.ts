import { z } from 'zod'

export const EUDR_COMMODITIES = ['cattle', 'cocoa', 'coffee', 'oil_palm', 'rubber', 'soya', 'wood'] as const
export type EudrCommodity = (typeof EUDR_COMMODITIES)[number]

export const EUDR_SUBMISSION_STATUSES = ['draft', 'submitted', 'verified', 'rejected'] as const
export type EudrSubmissionStatus = (typeof EUDR_SUBMISSION_STATUSES)[number]

export const EUDR_STATEMENT_STATUSES = ['draft', 'submitted', 'available', 'withdrawn', 'archived'] as const
export type EudrStatementStatus = (typeof EUDR_STATEMENT_STATUSES)[number]

export const GEOJSON_TYPES = ['Feature', 'FeatureCollection', 'Point', 'Polygon', 'MultiPolygon'] as const

const uuid = () => z.string().uuid()
const geoJsonSizeLimit = 1_048_576
const serverComputedSubmissionFields = ['completenessScore', 'missingFields'] as const
const productSnapshotSchema = z.object({
  name: z.string().max(500).optional().nullable(),
  sku: z.string().max(255).optional().nullable(),
})
const supplierSnapshotSchema = z.object({
  displayName: z.string().max(500).optional().nullable(),
})

export const geoJsonSchema = z
  .object({
    type: z.enum(GEOJSON_TYPES),
  })
  .passthrough()
  .superRefine((value, context) => {
    try {
      const serialized = JSON.stringify(value)
      if (serialized.length <= geoJsonSizeLimit) return
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'eudr.errors.geolocationTooLarge',
      })
      return
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'eudr.errors.geolocationTooLarge',
    })
  })

export const productMappingCreateSchema = z.object({
  productId: uuid(),
  productSnapshot: productSnapshotSchema.optional().nullable(),
  commodity: z.enum(EUDR_COMMODITIES),
  hsCode: z.string().max(20).optional().nullable(),
  isInScope: z.boolean().optional(),
  notes: z.string().max(5000).optional().nullable(),
})

export const productMappingUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(productMappingCreateSchema.partial())

const evidenceSubmissionBaseSchema = z.object({
  supplierEntityId: uuid(),
  supplierSnapshot: supplierSnapshotSchema.optional().nullable(),
  commodity: z.enum(EUDR_COMMODITIES),
  productMappingId: uuid().optional().nullable(),
  statementId: uuid().optional().nullable(),
  originCountry: z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional().nullable(),
  geolocation: geoJsonSchema.optional().nullable(),
  quantityKg: z.coerce.number().positive().optional().nullable(),
  batchNumber: z.string().max(255).optional().nullable(),
  harvestFrom: z.coerce.date().optional().nullable(),
  harvestTo: z.coerce.date().optional().nullable(),
  producerName: z.string().max(500).optional().nullable(),
  attachmentIds: z.array(uuid()).max(100).optional(),
  status: z.enum(EUDR_SUBMISSION_STATUSES).optional(),
  notes: z.string().max(5000).optional().nullable(),
})

const rejectServerComputedSubmissionFieldsSchema = z.unknown().superRefine((input, context) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return
  const record = input as Record<string, unknown>
  for (const field of serverComputedSubmissionFields) {
    if (!(field in record)) continue
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: 'eudr.errors.serverComputedField',
    })
  }
})

function validateHarvestRange(input: { harvestFrom?: Date | null; harvestTo?: Date | null }, context: z.RefinementCtx): void {
  if (!input.harvestFrom || !input.harvestTo || input.harvestFrom <= input.harvestTo) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['harvestTo'],
    message: 'eudr.errors.harvestRange',
  })
}

export const evidenceSubmissionCreateSchema = rejectServerComputedSubmissionFieldsSchema.pipe(
  evidenceSubmissionBaseSchema.superRefine(validateHarvestRange),
)

export const evidenceSubmissionUpdateSchema = rejectServerComputedSubmissionFieldsSchema.pipe(
  z
    .object({
      id: uuid(),
    })
    .merge(evidenceSubmissionBaseSchema.partial())
    .superRefine(validateHarvestRange),
)

export const statementCreateSchema = z.object({
  title: z.string().min(1).max(500),
  commodity: z.enum(EUDR_COMMODITIES),
  referenceNumber: z.string().max(255).optional().nullable(),
  verificationNumber: z.string().max(255).optional().nullable(),
  status: z.enum(EUDR_STATEMENT_STATUSES).optional(),
  quantityKg: z.coerce.number().positive().optional().nullable(),
  orderId: uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
})

export const statementUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(statementCreateSchema.partial())

export type ProductMappingCreateInput = z.infer<typeof productMappingCreateSchema>
export type ProductMappingUpdateInput = z.infer<typeof productMappingUpdateSchema>
export type EvidenceSubmissionCreateInput = z.infer<typeof evidenceSubmissionCreateSchema>
export type EvidenceSubmissionUpdateInput = z.infer<typeof evidenceSubmissionUpdateSchema>
export type StatementCreateInput = z.infer<typeof statementCreateSchema>
export type StatementUpdateInput = z.infer<typeof statementUpdateSchema>
