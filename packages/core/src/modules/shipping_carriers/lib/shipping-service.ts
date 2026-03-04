import type {
  CalculateRatesInput,
  CreateShipmentInput,
  CreateShipmentResult,
  GetTrackingInput,
  TrackingResult,
  CancelShipmentInput,
  CancelShipmentResult,
  ShippingRate,
} from './adapter'
import { getShippingAdapter } from './adapter-registry'

function requireAdapter(providerKey: string) {
  const adapter = getShippingAdapter(providerKey)
  if (!adapter) throw new Error(`Shipping adapter not found for provider '${providerKey}'`)
  return adapter
}

export async function calculateShippingRates(providerKey: string, input: CalculateRatesInput): Promise<ShippingRate[]> {
  return requireAdapter(providerKey).calculateRates(input)
}

export async function createCarrierShipment(providerKey: string, input: CreateShipmentInput): Promise<CreateShipmentResult> {
  return requireAdapter(providerKey).createShipment(input)
}

export async function getCarrierTracking(providerKey: string, input: GetTrackingInput): Promise<TrackingResult> {
  return requireAdapter(providerKey).getTracking(input)
}

export async function cancelCarrierShipment(providerKey: string, input: CancelShipmentInput): Promise<CancelShipmentResult> {
  return requireAdapter(providerKey).cancelShipment(input)
}
