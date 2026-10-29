import { z } from 'zod'
import { refineDefaultLocaleSupported, storeIdentityFormShape } from './StoreCreateDialog'
import { STORE_STATUSES, type StoreAdminRecord, type StoreStatus } from './storeAdmin'

export type StoreGeneralFormValues = {
  name: string
  code: string
  slug: string
  status: StoreStatus
  defaultLocale: string
  supportedLocales: string[]
  defaultCurrencyCode: string
}

export const storeGeneralFormSchema = z
  .object({ ...storeIdentityFormShape, status: z.enum(STORE_STATUSES) })
  .superRefine(refineDefaultLocaleSupported)

export function buildStoreGeneralInitialValues(store: StoreAdminRecord): StoreGeneralFormValues {
  return {
    name: store.name,
    code: store.code,
    slug: store.slug,
    status: store.status,
    defaultLocale: store.defaultLocale,
    supportedLocales: [...store.supportedLocales],
    defaultCurrencyCode: store.defaultCurrencyCode,
  }
}

export type StoreGeneralUpdatePayload = StoreGeneralFormValues & { id: string }

export function buildStoreGeneralPayload(storeId: string, values: StoreGeneralFormValues): StoreGeneralUpdatePayload {
  return {
    id: storeId,
    name: values.name.trim(),
    code: values.code.trim(),
    slug: values.slug.trim(),
    status: values.status,
    defaultLocale: values.defaultLocale.trim(),
    supportedLocales: values.supportedLocales.map((locale) => locale.trim()),
    defaultCurrencyCode: values.defaultCurrencyCode.trim().toUpperCase(),
  }
}

export type StoreDefaultPolicy = {
  id: string
  storeId: string | null
  productId: string | null
  variantId: string | null
  allowBackorder: boolean
  backorderLeadTimeDays: number | null
  hideWhenOutOfStock: boolean
  updatedAt: string | null
}

export type PolicyListResponse = {
  items: StoreDefaultPolicy[]
  total: number
  totalPages: number
}

export function isStoreDefaultPolicy(policy: StoreDefaultPolicy, storeId: string): boolean {
  return policy.storeId === storeId && !policy.productId && !policy.variantId
}

export type AvailabilityDefaultsFormValues = {
  hideWhenOutOfStock: boolean
  allowBackorder: boolean
  backorderLeadTimeDays?: number | string | null
}

export const AVAILABILITY_LEAD_TIME_REQUIRED_MESSAGE = 'ecommerce.validation.backorderLeadTimeRequired'

function parseLeadTimeDays(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number.parseInt(trimmed, 10)
}

export const availabilityDefaultsFormSchema = z
  .object({
    hideWhenOutOfStock: z.boolean(),
    allowBackorder: z.boolean(),
    backorderLeadTimeDays: z.union([z.number(), z.string(), z.null()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.allowBackorder) return
    if (parseLeadTimeDays(value.backorderLeadTimeDays) !== null) return
    ctx.addIssue({
      code: 'custom',
      path: ['backorderLeadTimeDays'],
      message: AVAILABILITY_LEAD_TIME_REQUIRED_MESSAGE,
    })
  })

export function buildAvailabilityInitialValues(policy: StoreDefaultPolicy | null): AvailabilityDefaultsFormValues {
  return {
    hideWhenOutOfStock: policy?.hideWhenOutOfStock ?? false,
    allowBackorder: policy?.allowBackorder ?? false,
    backorderLeadTimeDays: policy?.backorderLeadTimeDays ?? null,
  }
}

type AvailabilityPolicyFields = {
  hideWhenOutOfStock: boolean
  allowBackorder: boolean
  backorderLeadTimeDays?: number
}

function buildAvailabilityFields(values: AvailabilityDefaultsFormValues): AvailabilityPolicyFields {
  const fields: AvailabilityPolicyFields = {
    hideWhenOutOfStock: values.hideWhenOutOfStock,
    allowBackorder: values.allowBackorder,
  }
  if (values.allowBackorder) {
    const leadTime = parseLeadTimeDays(values.backorderLeadTimeDays)
    if (leadTime !== null) fields.backorderLeadTimeDays = leadTime
  }
  return fields
}

export type AvailabilityCreatePayload = AvailabilityPolicyFields & {
  organizationId: string
  tenantId: string
  storeId: string
  productId: null
  variantId: null
}

export function buildAvailabilityCreatePayload(
  store: Pick<StoreAdminRecord, 'id' | 'organizationId' | 'tenantId'>,
  values: AvailabilityDefaultsFormValues,
): AvailabilityCreatePayload | null {
  if (!store.organizationId || !store.tenantId) return null
  return {
    organizationId: store.organizationId,
    tenantId: store.tenantId,
    storeId: store.id,
    productId: null,
    variantId: null,
    ...buildAvailabilityFields(values),
  }
}

export type AvailabilityUpdatePayload = AvailabilityPolicyFields & { id: string }

export function buildAvailabilityUpdatePayload(
  policyId: string,
  values: AvailabilityDefaultsFormValues,
): AvailabilityUpdatePayload {
  return { id: policyId, ...buildAvailabilityFields(values) }
}
