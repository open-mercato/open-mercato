import { z } from 'zod'

/** Query of `GET /api/gus_regon/lookup`. Format is permissive; checksum is validated in the route. */
export const lookupQuerySchema = z.object({
  nip: z.string().trim().min(1).max(32),
})

export const gusCompanySchema = z.object({
  nip: z.string(),
  regon: z.string().nullable(),
  name: z.string().nullable(),
  street: z.string().nullable(),
  buildingNumber: z.string().nullable(),
  flatNumber: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  voivodeship: z.string().nullable(),
  county: z.string().nullable(),
  commune: z.string().nullable(),
  type: z.string().nullable(),
  endDate: z.string().nullable(),
  country: z.literal('PL'),
})

export const lookupOkSchema = z.object({
  ok: z.literal(true),
  company: gusCompanySchema,
  candidates: z.array(gusCompanySchema),
})

export const lookupFailSchema = z.object({
  ok: z.literal(false),
  reason: z.enum(['not_found', 'unavailable', 'not_configured']),
})

export const lookupResponseSchema = z.union([lookupOkSchema, lookupFailSchema])

export type LookupQuery = z.infer<typeof lookupQuerySchema>
