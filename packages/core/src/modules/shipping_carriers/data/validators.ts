import { z } from 'zod'

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

export const calculateRatesSchema = z.object({
  providerKey: z.string().min(1),
  origin: addressSchema,
  destination: addressSchema,
  packages: z.array(packageSchema).min(1),
})

export const createShipmentSchema = z.object({
  providerKey: z.string().min(1),
  orderId: z.string().uuid(),
  origin: addressSchema,
  destination: addressSchema,
  packages: z.array(packageSchema).min(1),
  serviceCode: z.string().min(1),
  labelFormat: z.enum(['pdf', 'zpl', 'png']).optional(),
})

export const trackingQuerySchema = z.object({
  providerKey: z.string().min(1),
  shipmentId: z.string().uuid().optional(),
  trackingNumber: z.string().min(1).optional(),
}).refine((value) => Boolean(value.shipmentId || value.trackingNumber), {
  message: 'shipmentId or trackingNumber is required',
  path: ['shipmentId'],
})

export const cancelShipmentSchema = z.object({
  providerKey: z.string().min(1),
  shipmentId: z.string().uuid(),
  reason: z.string().max(200).optional(),
})
