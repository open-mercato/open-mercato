import { z } from 'zod'
import {
  ABSTRACT_LINE_RESOLUTIONS,
  BILLING_CYCLES,
  CARGO_UNITS,
  CHARGE_KINDS,
  DRIVER_INCENTIVE_TYPES,
  PAYMENT_METHODS,
  RATE_BASES,
  TRIP_SOURCES,
  TRUCK_TYPES,
} from './entities'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const dateOnlySchema = z.string().trim().regex(DATE_PATTERN, 'Expected a YYYY-MM-DD date')

function decimalAmount(options: { min?: number; max?: number } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .refine((value) => /^-?\d+(\.\d+)?$/.test(value), { message: 'Must be a decimal number' })
    .refine((value) => options.min === undefined || Number(value) >= options.min, {
      message: options.min === undefined ? 'Invalid amount' : `Must be at least ${options.min}`,
    })
    .refine((value) => options.max === undefined || Number(value) <= options.max, {
      message: options.max === undefined ? 'Invalid amount' : `Must be at most ${options.max}`,
    })
}

const nonNegativeAmount = decimalAmount({ min: 0 })
const signedAmount = decimalAmount()

export const customerSnapshotSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['company', 'person']),
  displayName: z.string().trim().min(1).max(500),
  primaryEmail: z.string().trim().max(320).optional().nullable(),
  primaryPhone: z.string().trim().max(50).optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
})

export type CustomerSnapshot = z.infer<typeof customerSnapshotSchema>

const vatRateSchema = z.coerce.number().min(0).max(100)

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  customerSnapshot: customerSnapshotSchema,
  cargoDescription: z.string().trim().min(1).max(2000),
  cargoWeightKg: nonNegativeAmount.optional().nullable(),
  cargoVolumeM3: nonNegativeAmount.optional().nullable(),
  cargoQuantity: nonNegativeAmount.optional().nullable(),
  cargoUnit: z.enum(CARGO_UNITS).optional().nullable(),
  cargoHazardous: z.boolean().optional(),
  cargoRefrigerated: z.boolean().optional(),
  temperatureMinC: signedAmount.optional().nullable(),
  temperatureMaxC: signedAmount.optional().nullable(),
  pickupLocation: z.string().trim().min(1).max(500),
  dropoffLocation: z.string().trim().min(1).max(500),
  pickupAddressSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
  dropoffAddressSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
  requestedPickupAt: z.string().datetime().or(z.date()).optional().nullable(),
  requestedDeliveryAt: z.string().datetime().or(z.date()).optional().nullable(),
  truckTypeRequired: z.enum(TRUCK_TYPES).optional(),
  agreedAmountNet: nonNegativeAmount,
  adjustmentAmountNet: signedAmount.optional().nullable(),
  adjustmentNote: z.string().trim().max(2000).optional().nullable(),
  currencyCode: z.string().trim().length(3).optional(),
  vatRate: vatRateSchema.optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const updateOrderSchema = createOrderSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>

export const orderActionSchema = z.object({ id: z.string().uuid() })

export const assignOrderSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  transportTripId: z.string().uuid().optional().nullable(),
})

export const deliverOrderSchema = z.object({
  id: z.string().uuid(),
  podDocumentId: z.string().uuid().optional().nullable(),
  podReference: z.string().trim().max(500).optional().nullable(),
  podReceivedByName: z.string().trim().max(500).optional().nullable(),
  podReceivedAt: z.string().datetime().or(z.date()).optional().nullable(),
})

export const cancelOrderSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(2000).optional().nullable(),
})

export type AssignOrderInput = z.infer<typeof assignOrderSchema>
export type DeliverOrderInput = z.infer<typeof deliverOrderSchema>
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>

const contractFieldsSchema = z.object({
  customerId: z.string().uuid(),
  customerSnapshot: customerSnapshotSchema,
  title: z.string().trim().min(1).max(500),
  validFrom: dateOnlySchema,
  validTo: dateOnlySchema,
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  currencyCode: z.string().trim().length(3).optional(),
  vatRate: vatRateSchema.optional(),
  requiresCustomerApproval: z.boolean().optional(),
  salesChannelId: z.string().uuid().optional().nullable(),
  signedAt: z.string().datetime().or(z.date()).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const createContractSchema = contractFieldsSchema.refine(
  (data) => new Date(data.validTo) >= new Date(data.validFrom),
  { message: 'validTo must not be before validFrom', path: ['validTo'] },
)

// Deliberately built from the unrefined base: zod v4 refuses `.partial()` on a
// refined object, and a partial update cannot validate the cross-field period
// anyway — the update command keeps the stored period consistent.
export const updateContractSchema = contractFieldsSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateContractInput = z.infer<typeof createContractSchema>
export type UpdateContractInput = z.infer<typeof updateContractSchema>

export const contractActionSchema = z.object({ id: z.string().uuid() })

export const createContractRouteSchema = z.object({
  contractId: z.string().uuid(),
  lineNumber: z.coerce.number().int().min(1).optional(),
  transportRouteId: z.string().uuid().optional().nullable(),
  routeCodeSnapshot: z.string().trim().max(100).optional().nullable(),
  origin: z.string().trim().min(1).max(500),
  destination: z.string().trim().min(1).max(500),
  rateBasis: z.enum(RATE_BASES).optional(),
  rateAmount: nonNegativeAmount,
  minimumCharge: nonNegativeAmount.optional().nullable(),
  currencyCode: z.string().trim().length(3).optional(),
  includesTolls: z.boolean().optional(),
  includesWaiting: z.boolean().optional(),
  freeWaitingMinutes: z.coerce.number().int().min(0).optional().nullable(),
  waitingRatePerHour: nonNegativeAmount.optional().nullable(),
  vehicleTypeId: z.string().uuid().optional().nullable(),
  equipmentType: z.string().trim().max(200).optional().nullable(),
  driverIncentiveType: z.enum(DRIVER_INCENTIVE_TYPES).optional(),
  driverIncentiveValue: nonNegativeAmount.optional().nullable(),
  vatRateOverride: vatRateSchema.optional().nullable(),
  isActive: z.boolean().optional(),
  effectiveFrom: dateOnlySchema.optional().nullable(),
  effectiveTo: dateOnlySchema.optional().nullable(),
  position: z.coerce.number().int().min(0).optional(),
})

export const updateContractRouteSchema = createContractRouteSchema
  .omit({ contractId: true })
  .partial()
  .extend({ id: z.string().uuid() })

export type CreateContractRouteInput = z.infer<typeof createContractRouteSchema>
export type UpdateContractRouteInput = z.infer<typeof updateContractRouteSchema>

const tripBaseSchema = z.object({
  source: z.enum(TRIP_SOURCES).optional(),
  contractId: z.string().uuid().optional().nullable(),
  contractRouteId: z.string().uuid().optional().nullable(),
  freightOrderId: z.string().uuid().optional().nullable(),
  executionDate: dateOnlySchema,
  quantity: nonNegativeAmount.optional(),
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  transportTripId: z.string().uuid().optional().nullable(),
  actualStartAt: z.string().datetime().or(z.date()).optional().nullable(),
  actualEndAt: z.string().datetime().or(z.date()).optional().nullable(),
  waitingMinutes: z.coerce.number().int().min(0).optional().nullable(),
  distanceKm: nonNegativeAmount.optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const createTripSchema = tripBaseSchema
  .refine(
    (data) =>
      data.source === 'spot'
        ? Boolean(data.freightOrderId)
        : Boolean(data.contractId && data.contractRouteId),
    { message: 'A contract trip needs a contract and rate line; a spot trip needs an order', path: ['contractId'] },
  )

export const updateTripSchema = tripBaseSchema.omit({ source: true }).partial().extend({
  id: z.string().uuid(),
})

export type CreateTripInput = z.infer<typeof createTripSchema>
export type UpdateTripInput = z.infer<typeof updateTripSchema>

export const tripActionSchema = z.object({ id: z.string().uuid() })

export const tripDeliverSchema = z.object({
  id: z.string().uuid(),
  podDocumentId: z.string().uuid().optional().nullable(),
  podReference: z.string().trim().max(500).optional().nullable(),
  podReceivedByName: z.string().trim().max(500).optional().nullable(),
  podReceivedAt: z.string().datetime().or(z.date()).optional().nullable(),
})

const tripChargeSchema = z.object({
  kind: z.enum(CHARGE_KINDS),
  description: z.string().trim().max(500).optional().nullable(),
  quantity: nonNegativeAmount.optional(),
  unitAmountNet: signedAmount,
  isTaxable: z.boolean().optional(),
  billable: z.boolean().optional(),
  position: z.coerce.number().int().min(0).optional(),
})

export const setTripChargesSchema = z.object({
  id: z.string().uuid(),
  charges: z.array(tripChargeSchema),
})

export type SetTripChargesInput = z.infer<typeof setTripChargesSchema>
export type TripChargeInput = z.infer<typeof tripChargeSchema>

export const generateAbstractSchema = z
  .object({
    contractId: z.string().uuid(),
    periodFrom: dateOnlySchema,
    periodTo: dateOnlySchema,
  })
  .refine((data) => new Date(data.periodTo) >= new Date(data.periodFrom), {
    message: 'periodTo must not be before periodFrom',
    path: ['periodTo'],
  })

export type GenerateAbstractInput = z.infer<typeof generateAbstractSchema>

export const abstractActionSchema = z.object({ id: z.string().uuid() })

export const abstractRespondSchema = z.object({
  id: z.string().uuid(),
  acceptedLineIds: z.array(z.string().uuid()).optional(),
  disputedLines: z.array(z.object({ lineId: z.string().uuid(), note: z.string().trim().min(1).max(2000) })).optional(),
})

export type AbstractRespondInput = z.infer<typeof abstractRespondSchema>

export const abstractResolveSchema = z.object({
  id: z.string().uuid(),
  resolutions: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        resolution: z.enum(ABSTRACT_LINE_RESOLUTIONS),
        resolutionNote: z.string().trim().min(1).max(2000),
        adjustedAmountNet: nonNegativeAmount.optional().nullable(),
      }),
    )
    .min(1),
})

export type AbstractResolveInput = z.infer<typeof abstractResolveSchema>

export const abstractOfflineApprovalSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().min(1).max(2000),
})

export const abstractFinalizeSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(1).max(2000),
})

export const abstractInvoiceSchema = z.object({
  id: z.string().uuid(),
})

export const abstractCancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(2000).optional().nullable(),
})

export const recordPaymentSchema = z
  .object({
    orderId: z.string().uuid().optional().nullable(),
    abstractId: z.string().uuid().optional().nullable(),
    amount: decimalAmount({ min: 0.01 }),
    currencyCode: z.string().trim().length(3).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    reference: z.string().trim().max(500).optional().nullable(),
    receivedAt: dateOnlySchema,
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((data) => Boolean(data.orderId) !== Boolean(data.abstractId), {
    message: 'Provide exactly one of orderId or abstractId',
    path: ['orderId'],
  })

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

export const voidPaymentSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
})

export const paymentSyncSchema = z
  .object({
    orderId: z.string().uuid().optional().nullable(),
    abstractId: z.string().uuid().optional().nullable(),
  })
  .refine((data) => Boolean(data.orderId) !== Boolean(data.abstractId), {
    message: 'Provide exactly one of orderId or abstractId',
    path: ['orderId'],
  })

export const freightSettingsStoredSchema = z.object({
  defaultRequiresCustomerApproval: z.boolean().optional(),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  defaultBillingCycle: z.enum(BILLING_CYCLES).optional(),
  // Fraction, not percent (0.15 = 15%) — the same shape saudi_localization uses
  // for its VAT rate setting.
  defaultVatRate: z.coerce.number().min(0).max(1).optional(),
  salesChannelId: z.string().uuid().nullable().optional(),
  requirePodForBilling: z.boolean().optional(),
  orderNumberPrefix: z.string().trim().min(1).max(8).optional(),
  contractNumberPrefix: z.string().trim().min(1).max(8).optional(),
  tripNumberPrefix: z.string().trim().min(1).max(8).optional(),
  abstractNumberPrefix: z.string().trim().min(1).max(8).optional(),
})

export const freightSettingsInputSchema = freightSettingsStoredSchema

export type FreightSettingsInput = z.infer<typeof freightSettingsInputSchema>
export type FreightSettingsStored = z.infer<typeof freightSettingsStoredSchema>
