import { CUSTOM_FIELD_PREFIX } from './format'
import type { ExplainResourceDescriptorView } from './types'

const CRUD_FORM_SPOT_ID_PREFIX = 'crud-form:'
const FORM_CUSTOM_FIELD_PREFIX = 'cf_'

/** Entity segment of a CrudForm spot id (`crud-form:customers.deal` → `customers.deal`). */
export function readFormEntityIdFromSpotId(spotId: string | null | undefined): string | null {
  if (!spotId || !spotId.startsWith(CRUD_FORM_SPOT_ID_PREFIX)) return null
  const entityId = spotId.slice(CRUD_FORM_SPOT_ID_PREFIX.length)
  return entityId.length > 0 ? entityId : null
}

/**
 * The explain resource behind a CrudForm: the resource declaring `formEntityId` in its
 * `formEntityIds`, otherwise the resource whose kind equals the form's `resourceKind`.
 */
export function findFormExplainResource(
  resources: readonly ExplainResourceDescriptorView[],
  formEntityId: string | null | undefined,
  resourceKind?: string | null,
): ExplainResourceDescriptorView | null {
  if (formEntityId) {
    const declared = resources.find((resource) => resource.formEntityIds.includes(formEntityId))
    if (declared) return declared
  }
  if (resourceKind) return resources.find((resource) => resource.resourceKind === resourceKind) ?? null
  return null
}

export function hasExplainableFormFields(resource: ExplainResourceDescriptorView): boolean {
  return resource.fields.length > 0 || resource.customFields !== null
}

function readCustomFieldKey(fieldId: string): string | null {
  if (fieldId.startsWith(FORM_CUSTOM_FIELD_PREFIX)) return fieldId.slice(FORM_CUSTOM_FIELD_PREFIX.length)
  if (fieldId.startsWith(CUSTOM_FIELD_PREFIX)) return fieldId.slice(CUSTOM_FIELD_PREFIX.length)
  return null
}

/**
 * Maps a CrudForm field id to the explain field key the viewer may request: a declared field
 * whose `key` (or `currentPath`) equals the id, or `cf:<key>` for a `cf_<key>` / `cf:<key>` custom
 * field when the resource exposes custom fields (and lists the key when it declares `allowKeys`).
 */
export function resolveExplainFieldKey(
  resource: ExplainResourceDescriptorView,
  fieldId: string | null | undefined,
): string | null {
  if (!fieldId) return null
  const customFieldKey = readCustomFieldKey(fieldId)
  if (customFieldKey !== null) {
    if (!customFieldKey || !resource.customFields) return null
    const allowKeys = resource.customFields.allowKeys
    if (allowKeys && !allowKeys.includes(customFieldKey)) return null
    return `${CUSTOM_FIELD_PREFIX}${customFieldKey}`
  }
  const byKey = resource.fields.find((field) => field.key === fieldId)
  if (byKey) return byKey.key
  const byCurrentPath = resource.fields.find((field) => field.currentPath === fieldId)
  return byCurrentPath ? byCurrentPath.key : null
}

export function findExplainFieldLabelKey(resource: ExplainResourceDescriptorView, fieldKey: string): string | null {
  return resource.fields.find((field) => field.key === fieldKey)?.labelKey ?? null
}
