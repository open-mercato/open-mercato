import { z } from 'zod'
import {
  RENTAL_CHECK_KINDS,
  RENTAL_CLIENT_TYPES,
  RENTAL_DURATION_TYPES,
  RENTAL_TYPES,
} from './entities'

export const dateTimeSchema = z.union([z.string().datetime(), z.coerce.date()])

function decimalAmount(options: { min?: number } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .refine((value) => /^-?\d+(\.\d+)?$/.test(value), { message: 'Must be a decimal number' })
    .refine((value) => options.min === undefined || Number(value) >= options.min, {
      message: options.min === undefined ? 'Invalid amount' : `Must be at least ${options.min}`,
    })
}

export const nonNegativeAmount = decimalAmount({ min: 0 })

export const customerSnapshotSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['company', 'person']),
  displayName: z.string().trim().min(1).max(500),
  primaryEmail: z.string().trim().max(320).optional().nullable(),
  primaryPhone: z.string().trim().max(50).optional().nullable(),
})

export const rentalFieldsSchema = z.object({
  customerId: z.string().uuid(),
  customerSnapshot: customerSnapshotSchema,
  rentalType: z.enum(RENTAL_TYPES).optional(),
  clientType: z.enum(RENTAL_CLIENT_TYPES).optional(),
  durationType: z.enum(RENTAL_DURATION_TYPES).optional(),
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  startAt: dateTimeSchema.optional().nullable(),
  endAt: dateTimeSchema.optional().nullable(),
  dailyRate: nonNegativeAmount.optional(),
  weeklyRate: nonNegativeAmount.optional(),
  monthlyRate: nonNegativeAmount.optional(),
  includedKm: z.coerce.number().int().min(0).optional().nullable(),
  extraKmRate: nonNegativeAmount.optional().nullable(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  currencyCode: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const createRentalContractSchema = rentalFieldsSchema.refine(
  (data) => !data.startAt || !data.endAt || new Date(data.endAt) >= new Date(data.startAt),
  { message: 'endAt must not be before startAt', path: ['endAt'] },
)

// Built from the unrefined base on purpose: zod refuses `.partial()` on a
// refined object, and a partial update cannot validate the cross-field window.
export const updateRentalContractSchema = rentalFieldsSchema.partial().extend({
  id: z.string().uuid(),
})

export const rentalContractActionSchema = z.object({ id: z.string().uuid() })

export const handoverRentalSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid().optional().nullable(),
  odoStartKm: z.coerce.number().int().min(0),
  fuelLevel: z.coerce.number().int().min(0).max(100).optional().nullable(),
  hasDamage: z.boolean().optional(),
  conditionNotes: z.string().trim().max(2000).optional().nullable(),
  actualStartAt: dateTimeSchema.optional().nullable(),
})

export const returnRentalSchema = z.object({
  id: z.string().uuid(),
  odoEndKm: z.coerce.number().int().min(0),
  fuelLevel: z.coerce.number().int().min(0).max(100).optional().nullable(),
  hasDamage: z.boolean().optional(),
  conditionNotes: z.string().trim().max(2000).optional().nullable(),
  actualEndAt: dateTimeSchema.optional().nullable(),
})

export const cancelRentalSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(2000).optional().nullable(),
})

export const recordRentalCheckSchema = z.object({
  contractId: z.string().uuid(),
  // The lifecycle checks belong to handover/return; this path records the
  // inspections in between, so it cannot rewrite the signed documents.
  kind: z.literal('inspection'),
  odometerKm: z.coerce.number().int().min(0),
  fuelLevel: z.coerce.number().int().min(0).max(100).optional().nullable(),
  hasDamage: z.boolean().optional(),
  conditionNotes: z.string().trim().max(2000).optional().nullable(),
  checkedAt: dateTimeSchema.optional().nullable(),
})

export type CreateRentalContractInput = z.infer<typeof createRentalContractSchema>
export type UpdateRentalContractInput = z.infer<typeof updateRentalContractSchema>
export type HandoverRentalInput = z.infer<typeof handoverRentalSchema>
export type ReturnRentalInput = z.infer<typeof returnRentalSchema>
export type CancelRentalInput = z.infer<typeof cancelRentalSchema>
export type RecordRentalCheckInput = z.infer<typeof recordRentalCheckSchema>
export type RentalCustomerSnapshot = z.infer<typeof customerSnapshotSchema>
