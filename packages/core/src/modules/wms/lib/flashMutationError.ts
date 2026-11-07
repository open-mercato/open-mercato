import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Maps a `requireFeatures` ACL feature id to the i18n key that names the
 * specific permission a 403 response is missing (#4102 follow-up — the
 * generic "Forbidden" toast didn't say what was denied).
 */
const FORBIDDEN_FEATURE_MESSAGE_KEYS: Record<string, string> = {
  'wms.manage_warehouses': 'wms.errors.forbidden.manageWarehouses',
  'wms.manage_zones': 'wms.errors.forbidden.manageZones',
  'wms.manage_locations': 'wms.errors.forbidden.manageLocations',
  'wms.manage_inventory': 'wms.errors.forbidden.manageInventory',
  'wms.manage_reservations': 'wms.errors.forbidden.manageReservations',
  'wms.adjust_inventory': 'wms.errors.forbidden.adjustInventory',
  'wms.receive_inventory': 'wms.errors.forbidden.receiveInventory',
  'wms.manage_asn': 'wms.errors.forbidden.manageAsn',
  'wms.manage_putaway': 'wms.errors.forbidden.managePutaway',
  'wms.cycle_count': 'wms.errors.forbidden.cycleCount',
  'wms.import': 'wms.errors.forbidden.import',
}

const FORBIDDEN_FEATURE_MESSAGE_FALLBACKS: Record<string, string> = {
  'wms.manage_warehouses': "You don't have permission to manage warehouses.",
  'wms.manage_zones': "You don't have permission to manage warehouse zones.",
  'wms.manage_locations': "You don't have permission to manage warehouse locations.",
  'wms.manage_inventory': "You don't have permission to manage inventory profiles.",
  'wms.manage_reservations': "You don't have permission to manage inventory reservations.",
  'wms.adjust_inventory': "You don't have permission to adjust or move inventory.",
  'wms.receive_inventory': "You don't have permission to receive inbound inventory.",
  'wms.manage_asn': "You don't have permission to manage ASNs.",
  'wms.manage_putaway': "You don't have permission to manage putaway tasks.",
  'wms.cycle_count': "You don't have permission to run cycle counts.",
  'wms.import': "You don't have permission to import inventory.",
}

/**
 * Maps WMS command error codes (the `error` field of the response body, copied
 * onto the thrown error by `raiseCrudError`) to translated operator messages so
 * dialogs never flash a raw token such as `location_capacity_exceeded`.
 */
const ERROR_CODE_MESSAGES: Record<string, { key: string; fallback: string }> = {
  duplicate_serial: {
    key: 'wms.errors.codes.duplicateSerial',
    fallback: 'One or more serial numbers are already in stock. Check the serials and try again.',
  },
  invalid_putaway_quantity: {
    key: 'wms.errors.codes.invalidPutawayQuantity',
    fallback: 'Enter a valid quantity greater than zero.',
  },
  invalid_qc_transition: {
    key: 'wms.errors.codes.invalidQcTransition',
    fallback: 'This line already has a QC decision that cannot be changed.',
  },
  location_capacity_exceeded: {
    key: 'wms.errors.codes.locationCapacityExceeded',
    fallback: 'The destination location does not have enough free capacity for this quantity.',
  },
  putaway_lot_mismatch: {
    key: 'wms.errors.codes.putawayLotMismatch',
    fallback: 'The lot does not match the lot assigned to this putaway task.',
  },
  putaway_quantity_exceeds_task: {
    key: 'wms.errors.codes.putawayQuantityExceedsTask',
    fallback: 'The confirmed quantity exceeds the open quantity of this putaway task.',
  },
}

function resolveErrorCodeMessage(error: unknown, t?: TranslateFn): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as Record<string, unknown>).error
  if (typeof code !== 'string') return null
  const entry = ERROR_CODE_MESSAGES[code]
  if (!entry) return null
  return t ? t(entry.key, entry.fallback) : entry.fallback
}

/**
 * Reads the 403 response's `requiredFeatures` (attached to the thrown error
 * by `raiseCrudError`) and, when the missing feature is a known WMS
 * permission, resolves a translated message naming it. Returns `null` when
 * the error isn't a recognized 403-with-features shape so callers can fall
 * back to the generic message.
 */
function resolveForbiddenFeatureMessage(error: unknown, t?: TranslateFn): string | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as Record<string, unknown>).status
  if (status !== 403) return null
  const requiredFeatures = (error as Record<string, unknown>).requiredFeatures
  if (!Array.isArray(requiredFeatures)) return null
  const knownFeature = requiredFeatures.find(
    (feature): feature is string => typeof feature === 'string' && feature in FORBIDDEN_FEATURE_MESSAGE_KEYS,
  )
  if (!knownFeature) return null
  const key = FORBIDDEN_FEATURE_MESSAGE_KEYS[knownFeature]
  const fallback = FORBIDDEN_FEATURE_MESSAGE_FALLBACKS[knownFeature]
  return t ? t(key, fallback) : fallback
}

/**
 * Surfaces a mutation failure as an error flash toast. Prefers a
 * feature-specific 403 message derived from the server's `requiredFeatures`
 * hint (#4102 follow-up), then a translated message for a known WMS error
 * code, then the thrown error's own message (already server-derived and
 * translated by `raiseCrudError`/`useGuardedMutation`), and falls back to a
 * translated, dialog-specific message otherwise (#4103).
 */
export function flashMutationError(error: unknown, fallbackMessage: string, t?: TranslateFn): void {
  const forbiddenMessage = resolveForbiddenFeatureMessage(error, t)
  if (forbiddenMessage) {
    flash(forbiddenMessage, 'error')
    return
  }
  const errorCodeMessage = resolveErrorCodeMessage(error, t)
  if (errorCodeMessage) {
    flash(errorCodeMessage, 'error')
    return
  }
  // apiFetch throws ForbiddenError with a bare "Forbidden" message when the
  // ACL body has no mappable feature — prefer the dialog-specific fallback
  // over flashing the untranslated server token.
  const rawMessage = error instanceof Error ? error.message.trim() : ''
  const isGenericForbidden = rawMessage.length === 0 || /^forbidden$/i.test(rawMessage)
  flash(isGenericForbidden ? fallbackMessage : rawMessage, 'error')
}
