export type ShipmentItem = {
  id: string
  orderLineId: string
  orderLineName: string | null
  orderLineNumber: number | null
  quantity: number
  metadata: Record<string, unknown> | null
}

export type ShipmentRow = {
  id: string
  shipmentNumber: string | null
  shippingMethodId: string | null
  shippingMethodCode: string | null
  status: string | null
  statusEntryId: string | null
  carrierName: string | null
  trackingNumbers: string[]
  shippedAt: string | null
  deliveredAt: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  customValues: Record<string, unknown> | null
  items: ShipmentItem[]
  createdAt: string | null
}

export type OrderLine = {
  id: string
  title: string
  lineNumber: number | null
  quantity: number
}
