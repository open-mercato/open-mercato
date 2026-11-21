import { z } from 'zod'

export const carrierShipmentListQuerySchema = z.object({
  orderId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const carrierShipmentSummarySchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  providerKey: z.string(),
  carrierShipmentId: z.string(),
  trackingNumber: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const carrierShipmentListSchema = z.object({
  items: z.array(carrierShipmentSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  totalPages: z.number().int().nonnegative(),
})

export type CarrierShipmentSummary = z.infer<typeof carrierShipmentSummarySchema>
export type CarrierShipmentList = z.infer<typeof carrierShipmentListSchema>

const addressSchema = z.object({
  countryCode: z.string().min(2).max(3),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
})

const packageSchema = z.object({
  weightKg: z.number().positive(),
  lengthCm: z.number().positive(),
  widthCm: z.number().positive(),
  heightCm: z.number().positive(),
})

/** Permissive phone regex: allows +, digits, spaces, dashes, dots, and parentheses. Min 7 chars. */
export const PHONE_REGEX = /^[+\d][\d\s\-().]{6,}$/

const emailField = z.string().trim().email('Invalid email address.').max(320).optional()
const phoneField = z.string().trim().regex(PHONE_REGEX, 'Invalid phone number.').max(50).optional()

export const calculateRatesSchema = z.object({
  providerKey: z.string().min(1),
  origin: addressSchema,
  destination: addressSchema,
  packages: z.array(packageSchema).min(1),
  receiverPhone: phoneField,
  receiverEmail: emailField,
})

export const createShipmentSchema = z.object({
  providerKey: z.string().min(1),
  orderId: z.string().uuid(),
  origin: addressSchema,
  destination: addressSchema,
  packages: z.array(packageSchema).min(1),
  serviceCode: z.string().min(1),
  labelFormat: z.enum(['pdf', 'zpl', 'png']).optional(),
  senderPhone: phoneField,
  senderEmail: emailField,
  receiverPhone: phoneField,
  receiverEmail: emailField,
  targetPoint: z.string().optional(),
  c2cSendingMethod: z.enum(['parcel_locker', 'dispatch_order', 'pop', 'any_point']).optional(),
  idempotencyKey: z.string().min(1).max(255).optional(),
})

export const trackingQuerySchema = z.object({
  providerKey: z.string().min(1),
  shipmentId: z.string().uuid().optional(),
  trackingNumber: z.string().min(1).optional(),
}).refine((value) => Boolean(value.shipmentId || value.trackingNumber), {
  message: 'shipmentId or trackingNumber is required',
  path: ['shipmentId'],
})

export const trackingRefreshSchema = z.object({
  providerKey: z.string().min(1),
  shipmentId: z.string().uuid(),
})

export const cancelShipmentSchema = z.object({
  providerKey: z.string().min(1),
  shipmentId: z.string().uuid(),
  reason: z.string().max(200).optional(),
})

export const searchDropOffPointsQuerySchema = z.object({
  providerKey: z.string().min(1),
  query: z.string().optional(),
  type: z.string().optional(),
  postCode: z.string().optional(),
})
