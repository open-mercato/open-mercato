import { evaluateJsonLogic, type JsonLogicExpression } from './jsonlogic-evaluator'
import type { CompiledFormVersion } from './form-version-compiler'

/**
 * Phase 2c — resolve which fields are visible for a given role + current data.
 *
 * Decoupled from `SubmissionService` so it can be reused both server-side
 * (response slicing) and client-side (renderer hides fields live). The
 * server is authoritative; the client evaluator is a UX optimization only.
 *
 * Inputs:
 *   - compiled: phase 1a's `CompiledFormVersion` with the role policy
 *     lookup and the field schema nodes (we read `x-om-visibility-if`
 *     from the original schema).
 *   - schema: the original JSON Schema (we need to access raw
 *     `x-om-visibility-if` expressions; compiled `fieldIndex` only carries
 *     resolved descriptors).
 *   - role: the viewer's role.
 *   - data: decoded submission data.
 *
 * Output: `Set<string>` of visible field keys. Combine with the role
 * policy's visible set for the final response payload.
 */

export type VisibilitySchemaNode = {
  'x-om-visibility-if'?: JsonLogicExpression
}

export type VisibilityResolverArgs = {
  compiled: CompiledFormVersion
  schema: { properties?: Record<string, VisibilitySchemaNode> }
  role: string
  data: Record<string, unknown>
}

export function resolveVisibleFieldKeys(args: VisibilityResolverArgs): Set<string> {
  const visible = new Set<string>()
  const properties = args.schema.properties ?? {}
  for (const [fieldKey, node] of Object.entries(properties)) {
    const policy = args.compiled.rolePolicyLookup(args.role, fieldKey)
    if (!policy.canRead) continue
    const expr = node['x-om-visibility-if']
    if (expr === undefined || expr === null) {
      visible.add(fieldKey)
      continue
    }
    if (evaluateJsonLogic(expr, args.data)) {
      visible.add(fieldKey)
    }
  }
  return visible
}

export function sliceByVisibility<T extends Record<string, unknown>>(
  data: T,
  visible: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (visible.has(key)) out[key] = data[key]
  }
  return out
}
