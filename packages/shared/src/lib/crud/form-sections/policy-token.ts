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
