import { z } from 'zod'
import {
  ECOMMERCE_SEO_GOOGLE_VERIFICATION_MAX,
  ECOMMERCE_SEO_META_DESCRIPTION_MAX,
  ECOMMERCE_SEO_ROBOTS_TXT_MAX,
  ECOMMERCE_SEO_SITE_NAME_MAX,
  ecommerceStoreSeoSchema,
} from '../data/validators'
import type { StoreAdminRecord } from './storeAdmin'

export const STORE_SEO_FIELD_KEYS = ['siteName', 'defaultMetaDescription', 'googleSiteVerification', 'robotsTxt'] as const

export type StoreSeoFieldKey = (typeof STORE_SEO_FIELD_KEYS)[number]

export type StoreSeoFormValues = Record<StoreSeoFieldKey, string>

export const STORE_SEO_FIELD_LIMITS: Record<StoreSeoFieldKey, number> = {
  siteName: ECOMMERCE_SEO_SITE_NAME_MAX,
  defaultMetaDescription: ECOMMERCE_SEO_META_DESCRIPTION_MAX,
  googleSiteVerification: ECOMMERCE_SEO_GOOGLE_VERIFICATION_MAX,
  robotsTxt: ECOMMERCE_SEO_ROBOTS_TXT_MAX,
}

const SEO_FIELD_ERROR_PREFIX = 'settings.seo.'

type StoreSeoPayloadInput = Partial<Record<StoreSeoFieldKey, string>>

function buildStoreSeoInput(values: Partial<Record<StoreSeoFieldKey, unknown>>): StoreSeoPayloadInput {
  const input: StoreSeoPayloadInput = {}
  for (const key of STORE_SEO_FIELD_KEYS) {
    const value = values[key]
    if (typeof value !== 'string') continue
    if (value.trim().length === 0) continue
    input[key] = value
  }
  return input
}

const seoFormShape = {
  siteName: z.string(),
  defaultMetaDescription: z.string(),
  googleSiteVerification: z.string(),
  robotsTxt: z.string(),
} satisfies Record<StoreSeoFieldKey, z.ZodString>

export const storeSeoFormSchema = z.object(seoFormShape).superRefine((values, context) => {
  const result = ecommerceStoreSeoSchema.safeParse(buildStoreSeoInput(values))
  if (result.success) return
  for (const issue of result.error.issues) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
})

export function buildStoreSeoInitialValues(store: Pick<StoreAdminRecord, 'settings'>): StoreSeoFormValues {
  const parsed = ecommerceStoreSeoSchema.safeParse(store.settings?.seo ?? {})
  const stored = parsed.success ? parsed.data : {}
  return {
    siteName: stored.siteName ?? '',
    defaultMetaDescription: stored.defaultMetaDescription ?? '',
    googleSiteVerification: stored.googleSiteVerification ?? '',
    robotsTxt: stored.robotsTxt ?? '',
  }
}

export type StoreSeoUpdatePayload = { id: string; settings: { seo: StoreSeoPayloadInput } }

export function buildStoreSeoPayload(storeId: string, values: Partial<Record<StoreSeoFieldKey, unknown>>): StoreSeoUpdatePayload {
  return { id: storeId, settings: { seo: buildStoreSeoInput(values) } }
}

export function remapStoreSeoFieldErrors(fieldErrors: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fieldErrors) return undefined
  const mapped: Record<string, string> = {}
  for (const [key, message] of Object.entries(fieldErrors)) {
    mapped[key.startsWith(SEO_FIELD_ERROR_PREFIX) ? key.slice(SEO_FIELD_ERROR_PREFIX.length) : key] = message
  }
  return mapped
}
