import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type InventoryTrackingProfile = {
  trackLot?: boolean | null
  trackSerial?: boolean | null
} | null

type InventoryTrackingInput = {
  lotId?: string | null
  serialNumber?: string | null
}

export function enforceInventoryTrackingRequirements(
  profile: InventoryTrackingProfile,
  input: InventoryTrackingInput,
): void {
  if (profile?.trackLot && !input.lotId?.trim()) {
    throw new CrudHttpError(422, { error: 'lot_required' })
  }
  if (profile?.trackSerial && !input.serialNumber?.trim()) {
    throw new CrudHttpError(422, { error: 'serial_required' })
  }
}
