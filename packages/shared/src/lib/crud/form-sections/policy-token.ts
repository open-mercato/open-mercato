import type { CrudFormSectionHostAssertion } from '../../../modules/form-sections'
import type { CrudFormSectionAcceptedPolicy } from './manifest'
import { canonicalSectionJson } from './composition'
import {
  crudFormSectionPolicyTokenBodySchema,
  crudFormSectionsPolicyMaxBytes,
  policyTokenSchema,
  type CrudFormSectionPolicyTokenBody,
} from './protocol'

export function encodeCrudFormSectionPolicyToken(payload: CrudFormSectionPolicyTokenBody): string | null {
  const result = crudFormSectionPolicyTokenBodySchema.safeParse(payload)
  if (!result.success) return null
  const bytes = Buffer.from(canonicalSectionJson(result.data), 'utf8')
  return bytes.length > crudFormSectionsPolicyMaxBytes ? null : bytes.toString('base64url')
}

export function decodeCrudFormSectionPolicyToken(token: string): CrudFormSectionPolicyTokenBody | null {
  if (!policyTokenSchema.safeParse(token).success) return null
  const bytes = Buffer.from(token, 'base64url')
  if (bytes.length > crudFormSectionsPolicyMaxBytes || bytes.toString('base64url') !== token) return null
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const decoded = crudFormSectionPolicyTokenBodySchema.safeParse(JSON.parse(json))
    return decoded.success && canonicalSectionJson(decoded.data) === json ? decoded.data : null
  } catch {
    return null
  }
}

export function encodeCurrentCrudFormSectionPolicyToken(input: {
  address: Pick<CrudFormSectionPolicyTokenBody, 'hostId' | 'formVariant' | 'formOperation'>
  host: CrudFormSectionHostAssertion
  policy: CrudFormSectionAcceptedPolicy
  fingerprint: string
}): string | null {
  const { address, host, policy, fingerprint } = input
  return encodeCrudFormSectionPolicyToken({
    protocol: 'crud-form-sections/v1',
    schemaVersion: 1,
    ...address,
    ...host,
    contributionIds: [...policy.surface.contributionIds],
    roundTripIds: [...policy.roundTripIds],
    capabilityIds: policy.capabilities.map(({ fact }) => fact.capabilityId),
    orderedActiveSectionIds: [...policy.surface.orderedSectionIds],
    clientManifestFingerprint: policy.clientFingerprint,
    fingerprint,
  })
}
