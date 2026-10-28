import { z } from 'zod'

const uuid = () => z.string().uuid()

export const MAX_METRES = 99999.99
export const MAX_FLOORS_BELOW = 20
export const MAX_FLOORS_ABOVE = 200

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const position = z.coerce.number().finite().min(0).max(MAX_METRES)
const length = z.coerce.number().finite().gt(0).max(MAX_METRES)
const nameSchema = z.string().trim().min(1).max(200)

export const COMMON_AREA_KINDS = ['corridor', 'kitchen', 'toilets', 'lobby', 'stairs_lifts', 'storage', 'other'] as const
export const PRODUCT_USES = ['leasable', 'bookable'] as const
export const BILLING_UNITS = ['month', 'hour', 'day'] as const

export const commonAreaKindSchema = z.enum(COMMON_AREA_KINDS)
export const productUseKindSchema = z.enum(PRODUCT_USES)
export const billingUnitSchema = z.enum(BILLING_UNITS)

export const floorLayoutEntrySchema = z.object({
  number: z.coerce.number().int().min(-MAX_FLOORS_BELOW).max(MAX_FLOORS_ABOVE - 1),
  name: nameSchema,
  sizeX: length,
  sizeY: length,
})

export const floorLayoutSchema = z
  .object({
    below: z.coerce.number().int().min(0).max(MAX_FLOORS_BELOW),
    above: z.coerce.number().int().min(1).max(MAX_FLOORS_ABOVE),
    floors: z.array(floorLayoutEntrySchema).max(MAX_FLOORS_BELOW + MAX_FLOORS_ABOVE),
  })
  .superRefine((value, ctx) => {
    const expected = new Set<number>()
    for (let index = 1; index <= value.below; index += 1) expected.add(-index)
    for (let index = 0; index < value.above; index += 1) expected.add(index)
    const seen = new Set<number>()
    for (const [index, floor] of value.floors.entries()) {
      if (!expected.has(floor.number) || seen.has(floor.number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['floors', index, 'number'],
          message: 'property_management.errors.floorNumberInvalid',
        })
      }
      seen.add(floor.number)
    }
    if (seen.size !== expected.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['floors'],
        message: 'property_management.errors.floorRowsMismatch',
      })
    }
  })

export type FloorLayoutInput = z.infer<typeof floorLayoutSchema>
export type FloorLayoutEntry = z.infer<typeof floorLayoutEntrySchema>

const managerUserIdsSchema = z.array(uuid()).max(100)

export const buildingCreateSchema = scopedSchema.extend({
  name: nameSchema,
  address: z.string().trim().min(1).max(500),
  managerUserIds: managerUserIdsSchema.optional(),
  layout: floorLayoutSchema,
})

export const buildingUpdateSchema = scopedSchema.extend({
  id: uuid(),
  name: nameSchema.optional(),
  address: z.string().trim().min(1).max(500).optional(),
  managerUserIds: managerUserIdsSchema.optional(),
  layout: floorLayoutSchema.optional(),
})

export const buildingIdSchema = scopedSchema.extend({ id: uuid() })

export const floorLayoutReplaceSchema = scopedSchema.extend({
  buildingId: uuid(),
  layout: floorLayoutSchema,
})

export const floorUpdateSchema = scopedSchema.extend({
  id: uuid(),
  name: nameSchema.optional(),
  sizeX: length.optional(),
  sizeY: length.optional(),
})

const rectFields = {
  x: position,
  y: position,
  width: length,
  depth: length,
}

export const spaceCreateSchema = scopedSchema.extend({
  floorId: uuid(),
  name: nameSchema,
  purpose: z.string().trim().max(500).nullable().optional(),
  ...rectFields,
})

export const spaceUpdateSchema = scopedSchema.extend({
  id: uuid(),
  name: nameSchema.optional(),
  purpose: z.string().trim().max(500).nullable().optional(),
  x: position.optional(),
  y: position.optional(),
  width: length.optional(),
  depth: length.optional(),
})

export const unitCreateSchema = scopedSchema.extend({
  floorId: uuid(),
  spaceId: uuid(),
  name: nameSchema,
  catalogCategoryId: uuid(),
  catalogProductId: uuid(),
  ...rectFields,
})

export const unitUpdateSchema = scopedSchema.extend({
  id: uuid(),
  spaceId: uuid().optional(),
  name: nameSchema.optional(),
  catalogCategoryId: uuid().optional(),
  catalogProductId: uuid().optional(),
  x: position.optional(),
  y: position.optional(),
  width: length.optional(),
  depth: length.optional(),
})

export const unitProductChangeSchema = scopedSchema.extend({
  id: uuid(),
  catalogProductId: uuid(),
  catalogCategoryId: uuid().optional(),
})

export const commonAreaCreateSchema = scopedSchema.extend({
  floorId: uuid(),
  name: nameSchema,
  kind: commonAreaKindSchema,
  ...rectFields,
})

export const commonAreaUpdateSchema = scopedSchema.extend({
  id: uuid(),
  name: nameSchema.optional(),
  kind: commonAreaKindSchema.optional(),
  x: position.optional(),
  y: position.optional(),
  width: length.optional(),
  depth: length.optional(),
})

export const productUseSetSchema = scopedSchema
  .extend({
    catalogProductId: uuid(),
    use: productUseKindSchema.nullable(),
    billingUnit: billingUnitSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.use === null) return
    const valid = value.use === 'leasable' ? value.billingUnit === 'month' : value.billingUnit === 'hour' || value.billingUnit === 'day'
    if (!valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingUnit'],
        message: 'property_management.errors.billingUnitInvalid',
      })
    }
  })

export type BuildingCreateInput = z.infer<typeof buildingCreateSchema>
export type BuildingUpdateInput = z.infer<typeof buildingUpdateSchema>
export type BuildingIdInput = z.infer<typeof buildingIdSchema>
export type FloorLayoutReplaceInput = z.infer<typeof floorLayoutReplaceSchema>
export type FloorUpdateInput = z.infer<typeof floorUpdateSchema>
export type SpaceCreateInput = z.infer<typeof spaceCreateSchema>
export type SpaceUpdateInput = z.infer<typeof spaceUpdateSchema>
export type UnitCreateInput = z.infer<typeof unitCreateSchema>
export type UnitUpdateInput = z.infer<typeof unitUpdateSchema>
export type UnitProductChangeInput = z.infer<typeof unitProductChangeSchema>
export type CommonAreaCreateInput = z.infer<typeof commonAreaCreateSchema>
export type CommonAreaUpdateInput = z.infer<typeof commonAreaUpdateSchema>
export type ProductUseSetInput = z.infer<typeof productUseSetSchema>

export const MAX_LEASE_TERM_MONTHS = 600
export const MIN_PROPOSAL_EXPIRY_DAYS = 1
export const MAX_PROPOSAL_EXPIRY_DAYS = 90
export const CANCEL_SETTLEMENT_VALUES = ['prorate', 'credit_full', 'keep'] as const

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'property_management.errors.dateInvalid')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }, 'property_management.errors.dateInvalid')

const moneyAmount = z.coerce
  .number()
  .finite()
  .gt(0, 'property_management.errors.rateInvalid')
  .max(999_999_999, 'property_management.errors.rateInvalid')
const termMonths = z.coerce.number().int().min(1, 'property_management.errors.termInvalid').max(MAX_LEASE_TERM_MONTHS, 'property_management.errors.termInvalid')
const expiresInDays = z.coerce.number().int().min(MIN_PROPOSAL_EXPIRY_DAYS).max(MAX_PROPOSAL_EXPIRY_DAYS)
const messageSchema = z.string().trim().max(4000)

export const cancelSettlementSchema = z.enum(CANCEL_SETTLEMENT_VALUES)

export const leaseCreateSchema = scopedSchema.extend({
  unitId: uuid(),
  customerCompanyId: uuid(),
  primaryContactPersonId: uuid().nullable().optional(),
  startsOn: isoDate,
  termMonths,
  monthlyRate: moneyAmount,
  asProposal: z.boolean().default(false),
  expiresInDays: expiresInDays.optional(),
  message: messageSchema.nullable().optional(),
})

export const leaseUpdateSchema = scopedSchema.extend({
  id: uuid(),
  primaryContactPersonId: uuid().nullable().optional(),
})

export const leaseIdSchema = scopedSchema.extend({ id: uuid() })

export const leaseEndSchema = scopedSchema.extend({
  id: uuid(),
  endsOn: isoDate,
  settlement: cancelSettlementSchema.optional(),
})

export const leaseExtensionSchema = scopedSchema.extend({
  id: uuid(),
  months: termMonths,
  monthlyRate: moneyAmount,
  asProposal: z.boolean().default(false),
  expiresInDays: expiresInDays.optional(),
  message: messageSchema.nullable().optional(),
})

export const leaseProposalIdSchema = scopedSchema.extend({
  id: uuid(),
  leaseId: uuid().optional(),
})

export const settingsSaveSchema = scopedSchema.extend({
  billingChannelId: uuid().nullable(),
  cancelledOrderStatusEntryId: uuid().nullable(),
  leaseEndingThresholdDays: z.coerce.number().int().min(1).max(365),
  bookingReminderMinutes: z.coerce.number().int().min(5).max(1440),
  proposalExpiryDays: z.coerce.number().int().min(MIN_PROPOSAL_EXPIRY_DAYS).max(MAX_PROPOSAL_EXPIRY_DAYS),
})

export const leaseCreateBodySchema = leaseCreateSchema.omit({ organizationId: true, tenantId: true })
export const leaseEndBodySchema = leaseEndSchema.omit({ organizationId: true, tenantId: true, id: true })
export const leaseExtensionBodySchema = leaseExtensionSchema.omit({ organizationId: true, tenantId: true, id: true })
export const settingsBodySchema = settingsSaveSchema.omit({ organizationId: true, tenantId: true })

export type LeaseCreateInput = z.infer<typeof leaseCreateSchema>
export type LeaseUpdateInput = z.infer<typeof leaseUpdateSchema>
export type LeaseIdInput = z.infer<typeof leaseIdSchema>
export type LeaseEndInput = z.infer<typeof leaseEndSchema>
export type LeaseExtensionInput = z.infer<typeof leaseExtensionSchema>
export type LeaseProposalIdInput = z.infer<typeof leaseProposalIdSchema>
export type SettingsSaveInput = z.infer<typeof settingsSaveSchema>
