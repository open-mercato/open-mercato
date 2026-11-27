export const RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY = 'resources.capacity_unit'

export const RESOURCES_CAPACITY_UNIT_DEFAULTS: Array<{ value: string; label: string }> = [
  { value: 'spots', label: 'Spots' },
  { value: 'units', label: 'Units' },
  { value: 'quantity', label: 'Quantity' },
]

export function normalizeCapacityInput(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim().length === 0) return null
  return Number(value)
}
