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
  postalCode: string
  city: string
  line1: string
  line2?: string
}

export type PackageInfo = {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type ShippingRate = {
  serviceCode: string
  serviceName: string
  amount: number
  currencyCode: string
  estimatedDays?: number
  guaranteedDelivery?: boolean
}

export type CreateShipmentInput = {
  orderId: string
  origin: Address
  destination: Address
  packages: PackageInfo[]
  serviceCode: string
  credentials: Record<string, unknown>
  labelFormat?: 'pdf' | 'zpl' | 'png'
}

export type CreateShipmentResult = {
  shipmentId: string
  trackingNumber: string
  labelUrl?: string
  labelData?: string
  estimatedDelivery?: Date
}

export type TrackingResult = {
  trackingNumber: string
  status: UnifiedShipmentStatus
  events: Array<{ status: UnifiedShipmentStatus; occurredAt: string; location?: string }>
}

export type ShippingWebhookEvent = {
  eventType: string
  eventId: string
  idempotencyKey: string
  data: Record<string, unknown>
  timestamp: Date
  trackingNumber?: string
}

export type DropOffPoint = {
  id: string
  name: string
  type: string
  city: string
  postalCode: string
  street: string
  latitude?: number
  longitude?: number
}

export type SearchDropOffPointsInput = {
  query?: string
  type?: string
  postCode?: string
  credentials: Record<string, unknown>
}

export interface ShippingAdapter {
  readonly providerKey: string
  calculateRates(input: {
    origin: Address
    destination: Address
    packages: PackageInfo[]
    credentials: Record<string, unknown>
  }): Promise<ShippingRate[]>
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>
  getTracking(input: {
    shipmentId?: string
    trackingNumber?: string
    credentials: Record<string, unknown>
  }): Promise<TrackingResult>
  cancelShipment(input: {
    shipmentId: string
    reason?: string
    credentials: Record<string, unknown>
  }): Promise<{ status: UnifiedShipmentStatus }>
  verifyWebhook(input: {
    rawBody: string | Buffer
    headers: Record<string, string | string[] | undefined>
    credentials: Record<string, unknown>
  }): Promise<ShippingWebhookEvent>
  mapStatus(carrierStatus: string): UnifiedShipmentStatus
  searchDropOffPoints?(input: SearchDropOffPointsInput): Promise<DropOffPoint[]>
}
