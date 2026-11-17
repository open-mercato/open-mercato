/**
 * Forms PrefillResolver (W8 / FD-1).
 *
 * Resolves logical prefill attribute keys (e.g. `"name"`, `"email"`, `"dob"`)
 * to concrete values for a known submission subject. The forms module never
 * depends on dental-os (or any consumer) entities — prefill is declarative
 * (`x-om-prefill` on a field) and pluggable. The default resolver maps only the
 * attributes available from the customer auth context; operators inject a
 * richer resolver (e.g. dental-os providing DOB) by overriding the
 * `formsPrefillResolver` DI key.
 *
 * Privacy posture: the resolver receives only an opaque principal (the values
 * the auth context already exposes) and returns plain values. No PII reaches
 * any event payload — seeded values land in the encrypted initial revision
 * exactly like any participant answer, role-filtered and AJV-validated by the
 * SubmissionService.
 */

import type { CompiledFormVersion } from './form-version-compiler'

/**
 * The minimal subject principal a resolver may key on. Mirrors the fields
 * exposed by `CustomerAuthContext` so the authenticated start route can pass
 * the auth context straight through. `null` / anonymous principals are
 * permitted — the resolver returns `{}`.
 */
export type PrefillPrincipal = {
  /** Customer / user subject identifier. */
  sub: string
  tenantId: string
  organizationId: string
  email?: string | null
  displayName?: string | null
  /** CRM entity ids — a richer resolver may use these to look up DOB etc. */
  customerEntityId?: string | null
  personEntityId?: string | null
}

export type PrefillRequest = {
  principal: PrefillPrincipal | null
  /** Logical attribute keys declared via `x-om-prefill` across the form's fields. */
  attributeKeys: readonly string[]
}

/**
 * Resolves a set of logical attribute keys to values for the given principal.
 * Implementations MUST:
 *  - return `{}` for an anonymous principal (`principal === null`),
 *  - omit unknown / unresolvable attribute keys (never emit `undefined`),
 *  - stay tenant-scoped (only read data the principal is entitled to).
 */
export interface PrefillResolver {
  resolve(request: PrefillRequest): Promise<Record<string, unknown>> | Record<string, unknown>
}

/**
 * Default resolver — maps the attributes available directly from the customer
 * auth context. Conservative by design: only `name` and `email` are known.
 * Unknown keys (e.g. `dob`) are omitted so an injected resolver can supply
 * them. Anonymous principals resolve to `{}`.
 */
export class DefaultPrefillResolver implements PrefillResolver {
  resolve(request: PrefillRequest): Record<string, unknown> {
    const { principal, attributeKeys } = request
    if (!principal) return {}
    const out: Record<string, unknown> = {}
    for (const attributeKey of attributeKeys) {
      switch (attributeKey) {
        case 'name': {
          const value = principal.displayName
          if (typeof value === 'string' && value.length > 0) out[attributeKey] = value
          break
        }
        case 'email': {
          const value = principal.email
          if (typeof value === 'string' && value.length > 0) out[attributeKey] = value
          break
        }
        default:
          // Unknown attribute — omitted. A richer injected resolver supplies it.
          break
      }
    }
    return out
  }
}

/**
 * Resolves the prefill seed for a submission start (W8). Reads `x-om-prefill`
 * declarations from the compiled `fieldIndex`, asks the resolver for the union
 * of declared attribute keys, then maps each resolved attribute back onto every
 * field that requested it. Returns a `{ [fieldKey]: value }` seed ready to pass
 * into `SubmissionService.start({ prefill })`. Returns `{}` when no field
 * declares `x-om-prefill` (no resolver call) or the principal is anonymous.
 */
export async function resolvePrefillSeed(args: {
  compiled: CompiledFormVersion
  resolver: PrefillResolver
  principal: PrefillPrincipal | null
}): Promise<Record<string, unknown>> {
  const { compiled, resolver, principal } = args
  const attributeByField = new Map<string, string>()
  const attributeKeys = new Set<string>()
  for (const descriptor of Object.values(compiled.fieldIndex)) {
    const attribute = descriptor.prefillAttribute
    if (!attribute) continue
    attributeByField.set(descriptor.key, attribute)
    attributeKeys.add(attribute)
  }
  if (attributeKeys.size === 0) return {}

  const resolved = await resolver.resolve({
    principal,
    attributeKeys: Array.from(attributeKeys),
  })

  const seed: Record<string, unknown> = {}
  for (const [fieldKey, attribute] of attributeByField) {
    if (!Object.prototype.hasOwnProperty.call(resolved, attribute)) continue
    const value = resolved[attribute]
    if (value === null || value === undefined) continue
    seed[fieldKey] = value
  }
  return seed
}
