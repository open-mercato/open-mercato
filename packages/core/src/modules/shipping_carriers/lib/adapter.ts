export type UnifiedShipmentStatus =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_delivery'
  | 'returned'
  | 'cancelled'
  | 'unknown'

export type Address = {
  countryCode: string
  postalCode?: string
  city?: string
  line1?: string
  line2?: string
  state?: string
}

export type PackageInfo = {
  weightKg?: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
}

export interface CalculateRatesInput {
  origin: Address
  destination: Address
  packages: PackageInfo[]
  credentials: Record<string, unknown>
}

export interface ShippingRate {
  serviceCode: string
  serviceName: string
  amount: number
  currencyCode: string
  estimatedDays?: number
  guaranteedDelivery?: boolean
}

export interface CreateShipmentInput {
  orderId: string
  origin: Address
  destination: Address
  packages: PackageInfo[]
  serviceCode: string
  credentials: Record<string, unknown>
  labelFormat?: 'pdf' | 'zpl' | 'png'
}

export interface CreateShipmentResult {
  shipmentId: string
  trackingNumber: string
  status: UnifiedShipmentStatus
  labelUrl?: string
  labelData?: string
  estimatedDelivery?: Date
}

export interface GetTrackingInput {
  trackingNumber: string
  credentials: Record<string, unknown>
}

export interface TrackingResult {
  trackingNumber: string
  status: UnifiedShipmentStatus
  events?: Array<{ status: UnifiedShipmentStatus; occurredAt: string; location?: string }>
}

export interface CancelShipmentInput {
  shipmentId: string
  reason?: string
  credentials: Record<string, unknown>
}

export interface CancelShipmentResult {
  status: UnifiedShipmentStatus
}

export interface VerifyWebhookInput {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
}

export interface ShippingWebhookEvent {
  eventType: string
  eventId: string
  shipmentId?: string
  trackingNumber?: string
  status?: UnifiedShipmentStatus
  payload: Record<string, unknown>
}

export interface ShippingAdapter {
  readonly providerKey: string
  calculateRates(input: CalculateRatesInput): Promise<ShippingRate[]>
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>
  getTracking(input: GetTrackingInput): Promise<TrackingResult>
  cancelShipment(input: CancelShipmentInput): Promise<CancelShipmentResult>
  verifyWebhook(input: VerifyWebhookInput): Promise<ShippingWebhookEvent>
  mapStatus(carrierStatus: string): UnifiedShipmentStatus
}
