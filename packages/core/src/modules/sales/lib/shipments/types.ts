export type ShipmentItemSnapshot = {
  id: string
  orderLineId: string
  orderLineName: string | null
  orderLineNumber: number | null
  quantity: number
  metadata: Record<string, unknown> | null
}
