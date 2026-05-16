import { z } from 'zod'

export const championLeadTechStatusSchema = z.enum(['new', 'created_contact', 'matched_contact', 'manual_review', 'rejected', 'error'])
export const championLeadQualificationStatusSchema = z.enum(['do_kwalifikacji', 'zakwalifikowany', 'niezakwalifikowany', 'spam', 'pomylka'])
export const championDealStageSchema = z.enum(['qualified', 'offer_open', 'reservation_agreement', 'won', 'lost'])

const nullableText = z.string().trim().max(500).optional().nullable()
const nullableUuid = z.string().uuid().optional().nullable()
const nullableDate = z.union([z.string().datetime(), z.date()]).optional().nullable()

export const championLeadCreateSchema = z.object({
  id: z.string().uuid().optional(),
  source: nullableText,
  sourceExternalId: nullableText,
  sourcePayload: z.record(z.string(), z.unknown()).optional(),
  apiIdempotencyKey: nullableText,
  formType: nullableText,
  message: z.string().trim().max(5000).optional().nullable(),
  investmentId: nullableUuid,
  utmSource: nullableText,
  utmMedium: nullableText,
  utmCampaign: nullableText,
  utmTerm: nullableText,
  utmContent: nullableText,
  email: nullableText,
  emailNormalized: nullableText,
  phone: nullableText,
  phoneE164: nullableText,
  name: nullableText,
  nameRaw: nullableText,
  techStatus: championLeadTechStatusSchema.optional(),
  qualificationStatus: championLeadQualificationStatusSchema.optional(),
  disqualificationReason: nullableText,
  contactId: nullableUuid,
  dealId: nullableUuid,
  ownerUserId: nullableUuid,
  qualifiedAt: nullableDate,
  qualificationStatusChangedAt: nullableDate,
  qualificationHistory: z.array(z.record(z.string(), z.unknown())).optional(),
  disqualifiedAt: nullableDate,
  lastAttemptAt: nullableDate,
  submittedAt: nullableDate,
  receivedAt: nullableDate,
  nextFollowupAt: nullableDate,
})

export const championLeadUpdateSchema = championLeadCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const championLeadListQuerySchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  source: z.string().optional(),
  techStatus: championLeadTechStatusSchema.optional(),
  qualificationStatus: championLeadQualificationStatusSchema.optional(),
  contactId: z.string().uuid().optional(),
  sortField: z.string().optional().default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  format: z.enum(['json', 'csv']).optional(),
})

export const championConsentInputSchema = z.object({
  scope: z.enum(['contact_request', 'marketing_email', 'marketing_phone', 'privacy_policy']),
  granted: z.boolean(),
  textVersion: nullableText,
  capturedAt: nullableDate,
  evidence: z.record(z.string(), z.unknown()).optional(),
})

export const championLeadIntakeSchema = z.object({
  source: z.string().trim().min(1).max(200).default('api'),
  sourceExternalId: nullableText,
  apiIdempotencyKey: nullableText,
  formType: nullableText,
  payload: z.record(z.string(), z.unknown()).optional(),
  email: nullableText,
  phone: nullableText,
  name: nullableText,
  message: z.string().trim().max(5000).optional().nullable(),
  investmentId: nullableUuid,
  submittedAt: nullableDate,
  firstName: nullableText,
  lastName: nullableText,
  utm: z.object({
    source: nullableText,
    medium: nullableText,
    campaign: nullableText,
    term: nullableText,
    content: nullableText,
  }).optional(),
  utmSource: nullableText,
  utmMedium: nullableText,
  utmCampaign: nullableText,
  utmTerm: nullableText,
  utmContent: nullableText,
  consents: z.array(championConsentInputSchema).optional(),
}).passthrough()

export type ChampionLeadCreateInput = z.infer<typeof championLeadCreateSchema>
export type ChampionLeadUpdateInput = z.infer<typeof championLeadUpdateSchema>
export type ChampionLeadListQuery = z.infer<typeof championLeadListQuerySchema>
export type ChampionLeadIntakeInput = z.infer<typeof championLeadIntakeSchema>
export type ChampionConsentInput = z.infer<typeof championConsentInputSchema>
