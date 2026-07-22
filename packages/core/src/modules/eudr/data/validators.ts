import { z } from 'zod'

import { EUDR_RISK_CRITERIA_KEYS } from '../lib/reference-data'

export const EUDR_COMMODITIES = ['cattle', 'cocoa', 'coffee', 'oil_palm', 'rubber', 'soya', 'wood'] as const
export type EudrCommodity = (typeof EUDR_COMMODITIES)[number]

export const EUDR_SUBMISSION_STATUSES = ['draft', 'submitted', 'verified', 'rejected'] as const
export type EudrSubmissionStatus = (typeof EUDR_SUBMISSION_STATUSES)[number]

export const EUDR_STATEMENT_STATUSES = ['draft', 'submitted', 'available', 'withdrawn', 'archived'] as const
export type EudrStatementStatus = (typeof EUDR_STATEMENT_STATUSES)[number]

export const EUDR_PLOT_TYPES = ['point', 'polygon'] as const
export type EudrPlotType = (typeof EUDR_PLOT_TYPES)[number]

export const EUDR_RISK_TIERS = ['low', 'standard', 'high', 'mixed', 'unknown'] as const
export type EudrRiskTier = (typeof EUDR_RISK_TIERS)[number]

export const EUDR_RISK_CONCLUSIONS = ['negligible', 'non_negligible'] as const
export type EudrRiskConclusion = (typeof EUDR_RISK_CONCLUSIONS)[number]

export const EUDR_CRITERIA_ANSWERS = ['no_concern', 'concern', 'not_applicable'] as const
export type EudrCriteriaAnswer = (typeof EUDR_CRITERIA_ANSWERS)[number]

export const EUDR_MITIGATION_TYPES = [
  'request_documents',
  'supplier_audit',
  'satellite_verification',
  'certification_check',
  'switch_sourcing',
  'other',
] as const
export type EudrMitigationType = (typeof EUDR_MITIGATION_TYPES)[number]

export const EUDR_MITIGATION_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'] as const
export type EudrMitigationStatus = (typeof EUDR_MITIGATION_STATUSES)[number]

export const EUDR_ACTIVITY_TYPES = ['import', 'export', 'domestic_production', 'trade'] as const
export type EudrActivityType = (typeof EUDR_ACTIVITY_TYPES)[number]

export const EUDR_ACTOR_ROLES = ['operator', 'non_sme_trader', 'sme_trader'] as const
export type EudrActorRole = (typeof EUDR_ACTOR_ROLES)[number]

export const GEOJSON_TYPES = ['Feature', 'FeatureCollection', 'Point', 'Polygon', 'MultiPolygon'] as const

const uuid = () => z.string().uuid()
const geoJsonSizeLimit = 1_048_576
const serverComputedSubmissionFields = ['completenessScore', 'missingFields'] as const
const serverComputedPlotFields = ['validationWarnings', 'computedArea'] as const
const serverComputedRiskAssessmentFields = ['countryRisks', 'overallTier', 'isSimplified', 'assessedByName'] as const
const serverComputedMitigationActionFields = ['completedAt'] as const
const serverComputedStatementFields = ['submittedAt'] as const
const riskCriteriaKeySet = new Set(EUDR_RISK_CRITERIA_KEYS)

const productSnapshotSchema = z.object({
  name: z.string().max(500).optional().nullable(),
  sku: z.string().max(255).optional().nullable(),
})
const supplierSnapshotSchema = z.object({
  displayName: z.string().max(500).optional().nullable(),
})
const orderSnapshotSchema = z.object({
  orderNumber: z.string().max(255).optional().nullable(),
})

function rejectServerComputedFields(fields: readonly string[]): z.ZodType<unknown> {
  return z.unknown().superRefine((input, context) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return
    const record = input as Record<string, unknown>
    for (const field of fields) {
      if (!(field in record)) continue
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: 'eudr.errors.serverComputedField',
      })
    }
  })
}

function requiredUnknown(message: string): z.ZodType<unknown> {
  return z.unknown().refine((value) => value !== undefined, { message })
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// Route mapInput parses these schemas first (string -> Date) and commands parse
// the mapped input again, so both schemas must also accept Date instances.
const isoDateSchema = () => z.union([
  z.date(),
  z
    .string()
    .refine(isIsoDate, { message: 'eudr.errors.invalidDate' })
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
])

const isoDateTimeSchema = () => z.union([
  z.date(),
  z
    .string()
    .datetime({ message: 'eudr.errors.invalidDateTime' })
    .transform((value) => new Date(value)),
])

const pastOrNowIsoDateTimeSchema = () => isoDateTimeSchema().refine((value) => value.getTime() <= Date.now(), {
  message: 'eudr.errors.assessedAtInFuture',
})

const isoDateOrDateTimeSchema = () => z.union([isoDateSchema(), isoDateTimeSchema()])

// Country codes are validated through ICU rather than the shared country helper.
// That helper imports language-subtag-registry's JSON, and the build strips the
// import attribute Node's ESM loader requires, so importing it from server-side
// code (CLI, workers) fails with ERR_IMPORT_ATTRIBUTE_MISSING. UI components can
// keep using the helper because bundlers resolve the JSON themselves.
const countryDisplayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames !== 'undefined'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null

function isIsoCountryCode(value: string): boolean {
  // Without ICU data there is nothing to check against, so accept the shape.
  if (!countryDisplayNames) return true
  try {
    // Intl echoes the input back when it cannot resolve the region.
    const label = countryDisplayNames.of(value)
    return typeof label === 'string' && label !== value
  } catch {
    return false
  }
}

const countryCodeSchema = () => z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase())
  .refine(isIsoCountryCode, { message: 'eudr.errors.invalidCountry' })

const referencedStatementCodeSchema = (maxLength: number) => z
  .string()
  .trim()
  .min(1)
  .max(maxLength)
  .regex(/^[A-Za-z0-9._/-]+$/, { message: 'eudr.errors.invalidReferenceIdentifier' })
  .transform((value) => value.toUpperCase())

export const referencedStatementSchema = z.object({
  referenceNumber: referencedStatementCodeSchema(32),
  verificationNumber: referencedStatementCodeSchema(16).optional(),
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
  speciesScientificName: z.string().trim().max(256).optional().nullable(),
  speciesCommonName: z.string().trim().max(256).optional().nullable(),
  isInScope: z.boolean().optional(),
  notes: z.string().max(5000).optional().nullable(),
})

export const productMappingUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(productMappingCreateSchema.partial())

const plotBaseSchema = z.object({
  supplierEntityId: uuid(),
  supplierSnapshot: supplierSnapshotSchema.optional().nullable(),
  name: z.string().min(1).max(200),
  externalId: z.string().max(100).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  originCountry: countryCodeSchema(),
  geometry: requiredUnknown('eudr.errors.geometryRequired'),
  areaHa: z.coerce.number().positive().max(100_000).optional().nullable(),
  producerName: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
})

export const plotCreateSchema = rejectServerComputedFields(serverComputedPlotFields).pipe(plotBaseSchema)

export const plotUpdateSchema = rejectServerComputedFields(serverComputedPlotFields).pipe(
  z
    .object({
      id: uuid(),
    })
    .merge(plotBaseSchema.partial()),
)

const evidenceSubmissionBaseSchema = z.object({
  supplierEntityId: uuid(),
  supplierSnapshot: supplierSnapshotSchema.optional().nullable(),
  commodity: z.enum(EUDR_COMMODITIES),
  productMappingId: uuid().optional().nullable(),
  statementId: uuid().optional().nullable(),
  originCountry: countryCodeSchema().optional().nullable(),
  geolocation: geoJsonSchema.optional().nullable(),
  quantityKg: z.coerce.number().positive().optional().nullable(),
  batchNumber: z.string().max(255).optional().nullable(),
  harvestFrom: z.coerce.date().optional().nullable(),
  harvestTo: z.coerce.date().optional().nullable(),
  producerName: z.string().max(500).optional().nullable(),
  attachmentIds: z.array(uuid()).max(100).optional(),
  plotIds: z.array(uuid()).max(200).optional(),
  status: z.enum(EUDR_SUBMISSION_STATUSES).optional(),
  notes: z.string().max(5000).optional().nullable(),
})

function validateHarvestRange(input: { harvestFrom?: Date | null; harvestTo?: Date | null }, context: z.RefinementCtx): void {
  if (!input.harvestFrom || !input.harvestTo || input.harvestFrom <= input.harvestTo) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['harvestTo'],
    message: 'eudr.errors.harvestRange',
  })
}

export const evidenceSubmissionCreateSchema = rejectServerComputedFields(serverComputedSubmissionFields).pipe(
  evidenceSubmissionBaseSchema.superRefine(validateHarvestRange),
)

export const evidenceSubmissionUpdateSchema = rejectServerComputedFields(serverComputedSubmissionFields).pipe(
  z
    .object({
      id: uuid(),
    })
    .merge(evidenceSubmissionBaseSchema.partial())
    .superRefine(validateHarvestRange),
)

const riskCriteriaEntrySchema = z.object({
  answer: z.enum(EUDR_CRITERIA_ANSWERS),
  note: z.string().max(2000).optional().nullable(),
})

const riskCriteriaSchema = z.record(z.string(), riskCriteriaEntrySchema).superRefine((criteria, context) => {
  for (const key of Object.keys(criteria)) {
    if (riskCriteriaKeySet.has(key)) continue
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [key],
      message: 'eudr.errors.invalidRiskCriterion',
    })
  }
})

const riskAssessmentBaseSchema = z.object({
  statementId: uuid(),
  criteria: riskCriteriaSchema,
  conclusion: z.enum(EUDR_RISK_CONCLUSIONS),
  reviewDueAt: isoDateOrDateTimeSchema().optional().nullable(),
  assessedAt: pastOrNowIsoDateTimeSchema().optional(),
  notes: z.string().max(4000).optional().nullable(),
})

export const riskAssessmentCreateSchema = rejectServerComputedFields(serverComputedRiskAssessmentFields).pipe(riskAssessmentBaseSchema)

export const riskAssessmentUpdateSchema = rejectServerComputedFields(serverComputedRiskAssessmentFields).pipe(
  z
    .object({
      id: uuid(),
    })
    .merge(riskAssessmentBaseSchema.partial()),
)

const mitigationActionBaseSchema = z.object({
  riskAssessmentId: uuid(),
  actionType: z.enum(EUDR_MITIGATION_TYPES).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(EUDR_MITIGATION_STATUSES).optional(),
  dueDate: isoDateSchema().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export const mitigationActionCreateSchema = rejectServerComputedFields(serverComputedMitigationActionFields).pipe(mitigationActionBaseSchema)

export const mitigationActionUpdateSchema = rejectServerComputedFields(serverComputedMitigationActionFields).pipe(
  z
    .object({
      id: uuid(),
    })
    .merge(mitigationActionBaseSchema.partial()),
)

const statementBaseSchema = z.object({
  title: z.string().min(1).max(500),
  commodity: z.enum(EUDR_COMMODITIES),
  referenceNumber: z.string().max(255).optional().nullable(),
  verificationNumber: z.string().max(255).optional().nullable(),
  status: z.enum(EUDR_STATEMENT_STATUSES).optional(),
  activityType: z.enum(EUDR_ACTIVITY_TYPES).optional().nullable(),
  actorRole: z.enum(EUDR_ACTOR_ROLES).optional().nullable(),
  referencedStatements: z.array(referencedStatementSchema).max(100).optional(),
  quantityKg: z.coerce.number().positive().optional().nullable(),
  supplementaryUnit: z.string().max(16).optional().nullable(),
  supplementaryQuantity: z.coerce.number().positive().optional().nullable(),
  orderId: uuid().optional().nullable(),
  referenceIssuedAt: isoDateTimeSchema().optional().nullable(),
  orderSnapshot: orderSnapshotSchema.optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
})

export const statementCreateSchema = rejectServerComputedFields(serverComputedStatementFields).pipe(statementBaseSchema)

export const statementUpdateSchema = rejectServerComputedFields(serverComputedStatementFields).pipe(
  z
    .object({
      id: uuid(),
    })
    .merge(statementBaseSchema.partial()),
)

export type ProductMappingCreateInput = z.infer<typeof productMappingCreateSchema>
export type ProductMappingUpdateInput = z.infer<typeof productMappingUpdateSchema>
export type PlotCreateInput = z.infer<typeof plotCreateSchema>
export type PlotUpdateInput = z.infer<typeof plotUpdateSchema>
export type EvidenceSubmissionCreateInput = z.infer<typeof evidenceSubmissionCreateSchema>
export type EvidenceSubmissionUpdateInput = z.infer<typeof evidenceSubmissionUpdateSchema>
export type RiskAssessmentCreateInput = z.infer<typeof riskAssessmentCreateSchema>
export type RiskAssessmentUpdateInput = z.infer<typeof riskAssessmentUpdateSchema>
export type MitigationActionCreateInput = z.infer<typeof mitigationActionCreateSchema>
export type MitigationActionUpdateInput = z.infer<typeof mitigationActionUpdateSchema>
export type StatementCreateInput = z.infer<typeof statementCreateSchema>
export type StatementUpdateInput = z.infer<typeof statementUpdateSchema>
