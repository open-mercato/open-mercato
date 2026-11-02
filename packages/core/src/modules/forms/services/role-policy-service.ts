/**
 * Forms module RolePolicyService.
 *
 * Thin wrapper over the compiled form version's `rolePolicyLookup`. Resolves
 * per-(role, fieldKey) read/write decisions, plus the editable/visible field
 * sets a role can act on. Used by:
 *   - Submission API to filter incoming patches and slice responses.
 *   - Tampering-marker logger to identify dropped fields.
 *   - Studio (1b) compile-time warnings.
 *
 * The service is a deterministic function over the compiled form version;
 * it holds no per-tenant or per-submission state.
 */

import type { CompiledFormVersion } from './form-version-compiler'

export type RolePolicyResolution = {
  canRead(fieldKey: string): boolean
  canWrite(fieldKey: string): boolean
  editableFieldKeys(): string[]
  visibleFieldKeys(): string[]
  filterWritePatch(patch: Record<string, unknown>): {
    accepted: Record<string, unknown>
    droppedFieldKeys: string[]
  }
  sliceReadPayload(payload: Record<string, unknown>): Record<string, unknown>
}

export class RolePolicyService {
  resolve(compiled: CompiledFormVersion, role: string): RolePolicyResolution {
    const editableFieldKeysList = this.computeEditableFieldKeys(compiled, role)
    const visibleFieldKeysList = this.computeVisibleFieldKeys(compiled, role)
    const editableSet = new Set(editableFieldKeysList)
    const visibleSet = new Set(visibleFieldKeysList)

    return {
      canRead: (fieldKey) => visibleSet.has(fieldKey),
      canWrite: (fieldKey) => editableSet.has(fieldKey),
      editableFieldKeys: () => Array.from(editableSet),
      visibleFieldKeys: () => Array.from(visibleSet),
      filterWritePatch: (patch) => filterPatch(patch, editableSet),
      sliceReadPayload: (payload) => slicePayload(payload, visibleSet),
    }
  }

  private computeEditableFieldKeys(compiled: CompiledFormVersion, role: string): string[] {
    const result: string[] = []
    for (const [fieldKey, descriptor] of Object.entries(compiled.fieldIndex)) {
      if (descriptor.editableBy.includes(role)) result.push(fieldKey)
    }
    return result
  }

  private computeVisibleFieldKeys(compiled: CompiledFormVersion, role: string): string[] {
    const result: string[] = []
    for (const [fieldKey, descriptor] of Object.entries(compiled.fieldIndex)) {
      if (descriptor.visibleTo.includes(role) || descriptor.editableBy.includes(role)) {
        result.push(fieldKey)
      }
    }
    return result
  }
}

function filterPatch(
  patch: Record<string, unknown>,
  editableSet: Set<string>,
): { accepted: Record<string, unknown>; droppedFieldKeys: string[] } {
  const accepted: Record<string, unknown> = {}
  const droppedFieldKeys: string[] = []
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (editableSet.has(key)) {
      accepted[key] = value
    } else {
      droppedFieldKeys.push(key)
    }
  }
  return { accepted, droppedFieldKeys }
}

function slicePayload(
  payload: Record<string, unknown>,
  visibleSet: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (visibleSet.has(key)) out[key] = value
  }
  return out
}
