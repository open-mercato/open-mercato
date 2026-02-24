/**
 * SCIM PatchOp parser with Entra ID quirks:
 * - Case-insensitive `op` (e.g., "Replace" vs "replace")
 * - Boolean leniency ("False"/"True" strings → boolean)
 * - Strict attribute allowlist
 */

export interface ScimPatchOperation {
  op: string
  path?: string
  value?: unknown
}

const ALLOWED_PATHS = new Set([
  'active',
  'displayname',
  'name.givenname',
  'name.familyname',
  'username',
  'externalid',
])

export function parseScimPatchOperations(body: Record<string, unknown>): ScimPatchOperation[] {
  const operations = body.Operations as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(operations)) {
    throw new ScimPatchError('PatchOp body must contain Operations array')
  }

  return operations.map((rawOp) => {
    const op = String(rawOp.op ?? '').toLowerCase()
    if (!['add', 'replace', 'remove'].includes(op)) {
      throw new ScimPatchError(`Unsupported SCIM PatchOp: ${rawOp.op}`)
    }

    const path = rawOp.path ? String(rawOp.path) : undefined

    // Validate path against allowlist if present
    if (path) {
      const normalizedPath = path.toLowerCase()
      if (!ALLOWED_PATHS.has(normalizedPath)) {
        // Silently ignore unsupported attributes (Entra sends many)
        return { op, path, value: undefined }
      }
    }

    const value = normalizePatchValue(rawOp.value, path)

    return { op, path, value }
  }).filter((op) => {
    // Filter out no-ops (unsupported paths where value was set to undefined)
    if (op.op !== 'remove' && op.value === undefined && op.path) return false
    return true
  })
}

function normalizePatchValue(value: unknown, path?: string): unknown {
  if (value === undefined || value === null) return value

  // Handle boolean leniency for the `active` attribute
  if (path && path.toLowerCase() === 'active') {
    return coerceBoolean(value)
  }

  // Handle value objects (no-path operations)
  if (!path && typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      if (key.toLowerCase() === 'active') {
        normalized[key] = coerceBoolean(val)
      } else {
        normalized[key] = val
      }
    }
    return normalized
  }

  return value
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return Boolean(value)
}

export class ScimPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScimPatchError'
  }
}
