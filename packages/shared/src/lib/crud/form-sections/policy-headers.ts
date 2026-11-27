import { z } from 'zod'
import { buildExtensionHeader } from '../../umes/extension-headers'
import {
  fingerprintSchema,
  policyTokenSchema,
  resourceIdSchema,
  symbolicIdSchema,
} from './protocol'

export const crudFormSectionPolicyHeaderNames = {
  policyToken: buildExtensionHeader('crud-form-sections', 'policy'),
  fingerprint: buildExtensionHeader('crud-form-sections', 'fingerprint'),
  mutationSurfaceId: buildExtensionHeader('crud-form-sections', 'mutation-surface'),
  requestOperation: buildExtensionHeader('crud-form-sections', 'request-operation'),
  hostResourceKind: buildExtensionHeader('crud-form-sections', 'host-resource-kind'),
  hostResourceId: buildExtensionHeader('crud-form-sections', 'host-resource-id'),
  mutationResourceKind: buildExtensionHeader('crud-form-sections', 'mutation-resource-kind'),
  mutationResourceId: buildExtensionHeader('crud-form-sections', 'mutation-resource-id'),
} as const

export const crudFormSectionPolicyHeaderSchema = z.object({
  policyToken: policyTokenSchema,
  fingerprint: fingerprintSchema,
  mutationSurfaceId: symbolicIdSchema,
  requestOperation: symbolicIdSchema.max(64),
  hostResourceKind: symbolicIdSchema,
  hostResourceId: resourceIdSchema.optional(),
  mutationResourceKind: symbolicIdSchema,
  mutationResourceId: resourceIdSchema.optional(),
}).strict()

export type CrudFormSectionPolicyHeaderValues = z.infer<typeof crudFormSectionPolicyHeaderSchema>
type HeaderKey = keyof CrudFormSectionPolicyHeaderValues

const headerKeys = Object.keys(crudFormSectionPolicyHeaderNames) as HeaderKey[]

export function parseCrudFormSectionPolicyHeaders(headers: Headers): CrudFormSectionPolicyHeaderValues | null {
  const values: Partial<Record<HeaderKey, string>> = {}
  for (const name of headerKeys) {
    const value = headers.get(crudFormSectionPolicyHeaderNames[name])
    if (value === null) continue
    if (value.includes(',')) return null
    values[name] = value
  }
  const parsed = crudFormSectionPolicyHeaderSchema.safeParse(values)
  return parsed.success ? parsed.data : null
}

export function buildCrudFormSectionPolicyHeaders(
  values: CrudFormSectionPolicyHeaderValues,
  customHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(customHeaders)
  for (const name of headerKeys) {
    if (headers.has(crudFormSectionPolicyHeaderNames[name])) {
      throw new Error('[internal] custom header collides with a protected CrudForm section header')
    }
  }
  const parsed = crudFormSectionPolicyHeaderSchema.parse(values)
  for (const name of headerKeys) {
    const value = parsed[name]
    if (value !== undefined) headers.set(crudFormSectionPolicyHeaderNames[name], value)
  }
  return headers
}
