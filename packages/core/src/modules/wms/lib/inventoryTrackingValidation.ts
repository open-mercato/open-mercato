import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type InventoryTrackingProfile = {
  trackLot?: boolean | null
  trackSerial?: boolean | null
} | null

type InventoryTrackingInput = {
  lotId?: string | null
  serialNumber?: string | null
}

export function resolveInventoryTrackingError(
  profile: InventoryTrackingProfile,
  input: InventoryTrackingInput,
): 'lot_required' | 'serial_required' | null {
  if (profile?.trackLot && !input.lotId?.trim()) return 'lot_required'
  if (profile?.trackSerial && !input.serialNumber?.trim()) return 'serial_required'
  return null
}

export function enforceInventoryTrackingRequirements(
  profile: InventoryTrackingProfile,
  input: InventoryTrackingInput,
): void {
  const error = resolveInventoryTrackingError(profile, input)
  if (error) throw new CrudHttpError(422, { error })
}
