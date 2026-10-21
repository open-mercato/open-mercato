import { z } from 'zod'
import {
  ATTENDANCE_LEGS,
  ATTENDANCE_STATUSES,
  SUBSCRIPTION_ACCOUNT_TYPES,
  SUBSCRIPTION_DIRECTIONS,
  SUBSCRIPTION_DURATIONS,
} from './entities'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const dateOnlySchema = z.string().trim().regex(DATE_PATTERN, 'Expected a YYYY-MM-DD date')

export function decimalAmount(options: { min?: number } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .refine((value) => /^-?\d+(\.\d+)?$/.test(value), { message: 'Must be a decimal number' })
    .refine((value) => options.min === undefined || Number(value) >= options.min, {
      message: options.min === undefined ? 'Invalid amount' : `Must be at least ${options.min}`,
    })
}

export const nonNegativeAmount = decimalAmount({ min: 0 })
export const vatRateSchema = z.coerce.number().min(0).max(100)

export const customerSnapshotSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['company', 'person']),
  displayName: z.string().trim().min(1).max(500),
  primaryEmail: z.string().trim().max(320).optional().nullable(),
  primaryPhone: z.string().trim().max(50).optional().nullable(),
})

// ── Plans ────────────────────────────────────────────────────────────────────

export const planFieldsSchema = z.object({
  name: z.string().trim().min(1).max(300),
  code: z.string().trim().max(60).optional().nullable(),
  accountType: z.enum(SUBSCRIPTION_ACCOUNT_TYPES).optional(),
  duration: z.enum(SUBSCRIPTION_DURATIONS).optional(),
  priceTwoWay: nonNegativeAmount.optional(),
  priceOneWay: nonNegativeAmount.optional(),
  currencyCode: z.string().trim().length(3).optional(),
  taxRate: vatRateSchema.optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const createPlanSchema = planFieldsSchema
export const updatePlanSchema = planFieldsSchema.partial().extend({ id: z.string().uuid() })

// ── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptionFieldsSchema = z.object({
  studentName: z.string().trim().min(1).max(300),
  studentGrade: z.string().trim().max(120).optional().nullable(),
  guardianName: z.string().trim().max(300).optional().nullable(),
  guardianPhone: z.string().trim().max(50).optional().nullable(),
  accountType: z.enum(SUBSCRIPTION_ACCOUNT_TYPES).optional(),
  direction: z.enum(SUBSCRIPTION_DIRECTIONS).optional(),
  duration: z.enum(SUBSCRIPTION_DURATIONS).optional(),
  planId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid(),
  customerSnapshot: customerSnapshotSchema,
  schoolCustomerId: z.string().uuid().optional().nullable(),
  schoolSnapshot: customerSnapshotSchema.optional().nullable(),
  pickupPoint: z.string().trim().max(500).optional().nullable(),
  dropoffPoint: z.string().trim().max(500).optional().nullable(),
  transportRouteId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  startDate: dateOnlySchema.optional().nullable(),
  endDate: dateOnlySchema.optional().nullable(),
  periodPrice: nonNegativeAmount.optional(),
  currencyCode: z.string().trim().length(3).optional(),
  taxRate: vatRateSchema.optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const createSubscriptionSchema = subscriptionFieldsSchema
  .refine((data) => !data.startDate || !data.endDate || new Date(data.endDate) >= new Date(data.startDate), {
    message: 'endDate must not be before startDate',
    path: ['endDate'],
  })
  .refine((data) => data.accountType !== 'b2b' || Boolean(data.schoolCustomerId || data.customerId), {
    message: 'A B2B subscription names the school being billed.',
    path: ['schoolCustomerId'],
  })

export const updateSubscriptionSchema = subscriptionFieldsSchema.partial().extend({ id: z.string().uuid() })
export const subscriptionActionSchema = z.object({ id: z.string().uuid() })
export const endSubscriptionSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(2000).optional().nullable(),
})

export const invoiceSubscriptionSchema = z.object({
  id: z.string().uuid(),
  periodFrom: z.string().min(1).optional(),
  periodTo: z.string().min(1).optional(),
  dueAt: z.string().min(1).optional(),
  channelId: z.string().uuid().optional().nullable(),
})

// ── Attendance ───────────────────────────────────────────────────────────────

export const recordAttendanceSchema = z.object({
  subscriptionId: z.string().uuid(),
  tripDate: dateOnlySchema,
  leg: z.enum(ATTENDANCE_LEGS),
  status: z.enum(ATTENDANCE_STATUSES),
  origin: z.enum(['staff', 'parent']).optional(),
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const attendanceQuerySchema = z.object({
  mode: z.enum(['board', 'history']).optional(),
  tripDate: dateOnlySchema.optional(),
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  leg: z.enum(ATTENDANCE_LEGS).optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  subscriptionId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
})

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>
export type StudentCustomerSnapshot = z.infer<typeof customerSnapshotSchema>
