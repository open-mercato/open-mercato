import type { IntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'

const ALLOWED_CREDENTIAL_URL_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Validates that a credential value declared as `type: 'url'` is a syntactically
 * valid http(s) URL. Rejects free text, script fragments, and malformed URLs such as
 * `<script>alert(1)</script>` or `http://example.com<script>alert(1)</script>` — the
 * WHATWG URL parser refuses forbidden host code points (`<`, `>`) and missing schemes.
 */
export function isValidCredentialUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (!ALLOWED_CREDENTIAL_URL_PROTOCOLS.has(parsed.protocol)) return false
  if (!parsed.hostname) return false
  if (parsed.username || parsed.password) return false
  return true
}

export type CredentialUrlMessageBuilder = (field: { key: string; label: string }) => string

const defaultUrlMessageBuilder: CredentialUrlMessageBuilder = (field) =>
  `${field.label || field.key} must be a valid http(s) URL.`

/**
 * Collects field-level validation errors for `url`-typed credential fields against the
 * supplied integration credentials schema. Empty/absent values are skipped (required-ness
 * is enforced separately); only non-empty string values are checked for URL validity.
 *
 * Used by both the server-side credentials route (security enforcement) and the
 * client-side credential form (immediate feedback) so the rule stays single-sourced.
 */
export function collectCredentialUrlValidationErrors(
  schema: IntegrationCredentialsSchema | undefined,
  credentials: Record<string, unknown>,
  buildMessage: CredentialUrlMessageBuilder = defaultUrlMessageBuilder,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  if (!schema?.fields) return fieldErrors
  for (const field of schema.fields) {
    if (field.type !== 'url') continue
    const value = credentials[field.key]
    if (typeof value !== 'string') continue
    if (value.trim().length === 0) continue
    if (!isValidCredentialUrl(value)) {
      fieldErrors[field.key] = buildMessage({ key: field.key, label: field.label })
    }
  }
  return fieldErrors
}
