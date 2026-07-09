import { readVersionedPreference, writeVersionedPreference, clearVersionedPreference } from '@open-mercato/shared/lib/browser/versionedPreference'
import type { ModelPickerValue } from './ModelPicker'

const MODEL_PICKER_STORAGE_PREFIX = 'om-ai-model-picker:'

// Versioned-envelope discriminator for the persisted model-picker selection.
// Bump when the stored shape changes incompatibly; legacy bare `{ providerId,
// modelId }` values are migrated forward on the next write. See
// `@open-mercato/shared/lib/browser/versionedPreference`.
const MODEL_PICKER_VERSION = 1

function isModelPickerValue(value: unknown): value is ModelPickerValue {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).providerId === 'string' &&
    typeof (value as Record<string, unknown>).modelId === 'string'
  )
}

export function readModelPickerValue(agentId: string): ModelPickerValue | null {
  const value = readVersionedPreference<ModelPickerValue | null>(
    `${MODEL_PICKER_STORAGE_PREFIX}${agentId}`,
    MODEL_PICKER_VERSION,
    (candidate): candidate is ModelPickerValue | null => isModelPickerValue(candidate),
    null,
    { legacyIsValid: (candidate): candidate is ModelPickerValue | null => isModelPickerValue(candidate) },
  )
  return value ? { providerId: value.providerId, modelId: value.modelId } : null
}

export function writeModelPickerValue(agentId: string, value: ModelPickerValue | null): void {
  const key = `${MODEL_PICKER_STORAGE_PREFIX}${agentId}`
  if (value === null) {
    clearVersionedPreference(key)
    return
  }
  writeVersionedPreference(key, MODEL_PICKER_VERSION, { providerId: value.providerId, modelId: value.modelId })
}
