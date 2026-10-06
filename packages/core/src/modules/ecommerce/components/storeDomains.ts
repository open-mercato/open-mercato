import { z } from 'zod'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { DomainBindingMappingState } from '../data/enrichers'
import { ecommerceStoreDomainBindingCreateSchema, normalizePathPrefix } from '../data/validators'
import { isDomainMappingStatus, type DomainMappingStatus, type DomainMappingSummary } from '../lib/domainMappingSummaries'

export const DOMAIN_BINDINGS_API_PATH = 'ecommerce/store-domain-bindings'
export const DOMAIN_BINDINGS_API_URL = `/api/${DOMAIN_BINDINGS_API_PATH}`
export const DOMAIN_MAPPINGS_API_URL = '/api/ecommerce/domain-mappings'
export const DOMAIN_SETTINGS_HREF = '/backend/customer_accounts/settings/domain'
export const DOMAIN_BINDINGS_PAGE_SIZE = 100

export type DomainBindingRecord = {
  id: string
  storeId: string
  domainMappingId: string
  pathPrefix: string | null
  isPrimary: boolean
  createdAt: string | null
  updatedAt: string | null
  _domainMapping?: DomainBindingMappingState
}

export type DomainBindingListResponse = {
  items: DomainBindingRecord[]
  total: number
  totalPages: number
}

export type DomainMappingListResponse = {
  items: DomainMappingSummary[]
  total: number
}

export type DomainBindingFormValues = {
  domainMappingId: string
  pathPrefix: string
  isPrimary: boolean
}

export const DOMAIN_STATUS_VARIANTS: Record<DomainMappingStatus, StatusBadgeVariant> = {
  pending: 'info',
  verified: 'info',
  active: 'success',
  dns_failed: 'error',
  tls_failed: 'warning',
}

export const DOMAIN_STATUS_LABELS: Record<DomainMappingStatus, { key: string; fallback: string }> = {
  pending: { key: 'ecommerce.backend.store.domains.status.pending', fallback: 'Pending' },
  verified: { key: 'ecommerce.backend.store.domains.status.verified', fallback: 'Verified' },
  active: { key: 'ecommerce.backend.store.domains.status.active', fallback: 'Active' },
  dns_failed: { key: 'ecommerce.backend.store.domains.status.dnsFailed', fallback: 'DNS failed' },
  tls_failed: { key: 'ecommerce.backend.store.domains.status.tlsFailed', fallback: 'TLS failed' },
}

export function isServingStatus(status: string): boolean {
  return status === 'active'
}

export function describeDomainStatus(status: string): { variant: StatusBadgeVariant; key: string; fallback: string } {
  if (isDomainMappingStatus(status)) {
    return { variant: DOMAIN_STATUS_VARIANTS[status], ...DOMAIN_STATUS_LABELS[status] }
  }
  return { variant: 'neutral', key: '', fallback: status }
}

export function formatBindingAddress(hostname: string, pathPrefix: string | null): string {
  return `${hostname}${pathPrefix ?? ''}`
}

export function normalizeBindingPrefix(value: string | null | undefined): string | null {
  const normalized = normalizePathPrefix(value ?? null)
  return typeof normalized === 'string' && normalized.length > 0 ? normalized : null
}

export function findDuplicateBinding(
  bindings: readonly DomainBindingRecord[],
  candidate: { domainMappingId: string; pathPrefix: string | null },
  ignoreBindingId: string | null,
): DomainBindingRecord | null {
  return (
    bindings.find(
      (binding) =>
        binding.id !== ignoreBindingId &&
        binding.domainMappingId === candidate.domainMappingId &&
        (binding.pathPrefix ?? null) === candidate.pathPrefix,
    ) ?? null
  )
}

export function findPreviousPrimary(
  bindings: readonly DomainBindingRecord[],
  nextPrimaryId: string,
): DomainBindingRecord | null {
  return bindings.find((binding) => binding.isPrimary && binding.id !== nextPrimaryId) ?? null
}

const REQUIRED_MESSAGE = 'ui.forms.errors.required'

export const domainBindingFormSchema = z.object({
  domainMappingId: z.string().trim().min(1, REQUIRED_MESSAGE),
  pathPrefix: z
    .string()
    .superRefine((value, ctx) => {
      const parsed = ecommerceStoreDomainBindingCreateSchema.shape.pathPrefix.safeParse(value)
      if (!parsed.success) ctx.addIssue({ code: 'custom', message: 'ecommerce.validation.pathPrefixInvalid' })
    }),
  isPrimary: z.boolean(),
})

export function buildDomainBindingInitialValues(binding: DomainBindingRecord | null): DomainBindingFormValues {
  return {
    domainMappingId: binding?.domainMappingId ?? '',
    pathPrefix: binding?.pathPrefix ?? '',
    isPrimary: binding?.isPrimary ?? false,
  }
}

export function buildDomainBindingCreatePayload(
  storeId: string,
  values: DomainBindingFormValues,
): { storeId: string; domainMappingId: string; pathPrefix: string | null; isPrimary: boolean } {
  return {
    storeId,
    domainMappingId: values.domainMappingId,
    pathPrefix: normalizeBindingPrefix(values.pathPrefix),
    isPrimary: values.isPrimary === true,
  }
}

export function buildDomainBindingUpdatePayload(
  bindingId: string,
  values: DomainBindingFormValues,
): { id: string; domainMappingId: string; pathPrefix: string | null; isPrimary: boolean } {
  return {
    id: bindingId,
    domainMappingId: values.domainMappingId,
    pathPrefix: normalizeBindingPrefix(values.pathPrefix),
    isPrimary: values.isPrimary === true,
  }
}
