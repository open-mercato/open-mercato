/**
 * `file` field type — W4 (FA-4 file + SEC-4).
 *
 * Lets a participant upload a photo / file (e.g. a medication box) as part of
 * a submission. The persisted submission value is NEVER the bytes — it is a
 * lightweight reference array of `FileAttachmentRef`. The bytes live in a
 * `forms_form_attachment` row (`kind = 'user_upload'`), encrypted at rest via
 * the per-tenant `EncryptionService` (DP-1: file bytes are PHI).
 *
 * Value shape (single field key, always an array — single-file fields persist
 * an array of length 1):
 *   `[{ id, filename, contentType, sizeBytes }]`
 *
 * The `file` type is ADDITIVE — it is registered through the standard
 * `FieldTypeRegistry.register(...)` API and does NOT appear in the FROZEN v1
 * core list (`packages/forms/AGENTS.md § v1 Field Types`).
 *
 * New `x-om-*` keywords (all additive, registered in `jsonschema-extensions.ts`):
 *   - `x-om-accept`         — `string[]` MIME allowlist (empty/absent ⇒ any)
 *   - `x-om-max-size-bytes` — per-field max upload size in bytes
 *   - `x-om-multiple`       — allow more than one file (default false)
 */

import type { FieldNode, FieldTypeSpec } from './field-type-registry'

export const FILE_TYPE_KEY = 'file' as const

/** Reference persisted in the submission value for a single uploaded file. */
export type FileAttachmentRef = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
}

function isFileAttachmentRef(value: unknown): value is FileAttachmentRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (typeof candidate.filename !== 'string') return false
  if (typeof candidate.contentType !== 'string') return false
  if (typeof candidate.sizeBytes !== 'number' || !Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes < 0) {
    return false
  }
  return true
}

/**
 * Normalizes a stored value into an array of refs. Accepts:
 *   - a bare attachment id string (legacy / convenience),
 *   - a single `FileAttachmentRef` object,
 *   - an array of either.
 * Returns `null` when the value cannot be interpreted as file references.
 */
export function readFileRefs(value: unknown): FileAttachmentRef[] | null {
  if (value === null || value === undefined) return []
  const entries = Array.isArray(value) ? value : [value]
  const refs: FileAttachmentRef[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry.length === 0) return null
      refs.push({ id: entry, filename: '', contentType: '', sizeBytes: 0 })
      continue
    }
    if (!isFileAttachmentRef(entry)) return null
    refs.push({
      id: entry.id,
      filename: entry.filename,
      contentType: entry.contentType,
      sizeBytes: entry.sizeBytes,
    })
  }
  return refs
}

function fileFieldAllowsMultiple(fieldNode: FieldNode): boolean {
  return (fieldNode as Record<string, unknown>)['x-om-multiple'] === true
}

export const FILE_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (value === null || value === undefined) return true
    const refs = readFileRefs(value)
    if (refs === null) {
      return 'Expected an uploaded file reference (id string, object, or array).'
    }
    if (!fileFieldAllowsMultiple(fieldNode) && refs.length > 1) {
      return 'This field accepts a single file.'
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'file' },
  exportAdapter: (value) => {
    const refs = readFileRefs(value)
    if (!refs || refs.length === 0) return ''
    return refs.map((ref) => (ref.filename.length > 0 ? ref.filename : ref.id)).join(', ')
  },
  category: 'input',
  icon: 'paperclip',
  displayNameKey: 'forms.studio.palette.input.file',
}
