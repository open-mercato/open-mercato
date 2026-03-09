export type Unit = 'g' | 'ml' | 'unit'

export type ModifierOption = {
  id: string
  label: string
  priceDelta: number
}

export type ModifierGroup = {
  id: string
  label: string
  required?: boolean
  options: ModifierOption[]
}

export type RecipeLine = {
  ingredientId: string
  quantity: number
  unit: Unit
}

export type MenuItem = {
  id: string
  slug: string
  name: string
  category: string
  description: string
  price: number
  prepMinutes: number
  tags: string[]
  modifierGroups?: ModifierGroup[]
  recipe: RecipeLine[]
}

export type TableInfo = {
  id: string
  label: string
  zone: string
  seats: number
  qrPath: string
}

export type Ingredient = {
  id: string
  name: string
  unit: Unit
  onHand: number
  safetyStock: number
  incoming: number
  waste: number
  manualAdjustment: number
  supplier: string
  costPerUnit: number
}

export type CartLine = {
  id: string
  menuItemId: string
  quantity: number
  note: string
  selectedOptionIds: string[]
}

export type OrderStatus = 'queued' | 'preparing' | 'ready' | 'served'

export type OrderLine = CartLine & {
  unitPrice: number
  itemName: string
}

export type Order = {
  id: string
  tableId: string
  createdAtLabel: string
  status: OrderStatus
  paymentStatus: 'paid'
  priority: 'high' | 'normal'
  source: 'web-table'
  guestCount: number
  total: number
  lines: OrderLine[]
}

export type PurchaseReceipt = {
  id: string
  supplier: string
  status: 'pending' | 'received'
  reference: string
  entries: Array<{
    ingredientId: string
    quantity: number
  }>
}


export type StockAction = {
  ingredientId: string
  quantity: number
  type: 'waste' | 'adjustment'
  reason: string
}

export type RestaurantSeed = {
  restaurant: {
    name: string
    location: string
    serviceMode: string
    currency: string
    brandTone: string
  }
  tables: TableInfo[]
  menu: MenuItem[]
  ingredients: Ingredient[]
  orders: Order[]
  purchaseReceipts: PurchaseReceipt[]
}

export type InventorySnapshot = {
  ingredientId: string
  name: string
  unit: Unit
  current: number
  committed: number
  available: number
  incoming: number
  safetyStock: number
  reorderGap: number
  supplier: string
}
