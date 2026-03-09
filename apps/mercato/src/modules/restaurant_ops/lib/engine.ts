import { restaurantSeed } from './demo-data'
import type { CartLine, InventorySnapshot, MenuItem, Order, StockAction, Unit } from './types'

const menuById = new Map(restaurantSeed.menu.map((item) => [item.id, item]))

export function findMenuItem(menuItemId: string): MenuItem {
  const item = menuById.get(menuItemId)
  if (!item) {
    throw new Error(`Unknown menu item: ${menuItemId}`)
  }
  return item
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: restaurantSeed.restaurant.currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function unitLabel(unit: Unit): string {
  return unit === 'unit' ? 'uds' : unit
}

export function lineUnitPrice(line: CartLine): number {
  const item = findMenuItem(line.menuItemId)
  const optionDelta = (item.modifierGroups ?? [])
    .flatMap((group) => group.options)
    .filter((option) => line.selectedOptionIds.includes(option.id))
    .reduce((sum, option) => sum + option.priceDelta, 0)

  return item.price + optionDelta
}

export function selectedOptionLabels(line: CartLine): string[] {
  const item = findMenuItem(line.menuItemId)
  return (item.modifierGroups ?? [])
    .flatMap((group) => group.options)
    .filter((option) => line.selectedOptionIds.includes(option.id))
    .map((option) => option.label)
}

export function cartTotals(lines: CartLine[]) {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * lineUnitPrice(line), 0)
  const serviceFee = subtotal > 0 ? subtotal * 0.02 : 0
  const total = subtotal + serviceFee
  return { subtotal, serviceFee, total }
}

function aggregateRecipeUsage(lines: Array<{ menuItemId: string; quantity: number }>) {
  const usage = new Map<string, number>()

  for (const line of lines) {
    const item = findMenuItem(line.menuItemId)
    for (const recipeLine of item.recipe) {
      usage.set(recipeLine.ingredientId, (usage.get(recipeLine.ingredientId) ?? 0) + recipeLine.quantity * line.quantity)
    }
  }

  return usage
}

export function inventorySnapshot(orders: Order[], activeCart: CartLine[], receivedReceiptIds: string[], stockActions: StockAction[]): InventorySnapshot[] {
  const soldUsage = aggregateRecipeUsage(
    orders.flatMap((order) => order.lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity }))),
  )

  const committedUsage = aggregateRecipeUsage(activeCart.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })))

  const receiptTotals = new Map<string, number>()
  for (const receipt of restaurantSeed.purchaseReceipts.filter((receipt) => receivedReceiptIds.includes(receipt.id))) {
    for (const entry of receipt.entries) {
      receiptTotals.set(entry.ingredientId, (receiptTotals.get(entry.ingredientId) ?? 0) + entry.quantity)
    }
  }

  const wasteTotals = new Map<string, number>()
  const adjustmentTotals = new Map<string, number>()
  for (const action of stockActions) {
    const target = action.type === 'waste' ? wasteTotals : adjustmentTotals
    target.set(action.ingredientId, (target.get(action.ingredientId) ?? 0) + action.quantity)
  }

  return restaurantSeed.ingredients.map((ingredient) => {
    const receipts = receiptTotals.get(ingredient.id) ?? 0
    const sold = soldUsage.get(ingredient.id) ?? 0
    const committed = committedUsage.get(ingredient.id) ?? 0
    const extraWaste = wasteTotals.get(ingredient.id) ?? 0
    const extraAdjustments = adjustmentTotals.get(ingredient.id) ?? 0
    const current = ingredient.onHand + receipts + ingredient.manualAdjustment + extraAdjustments - ingredient.waste - extraWaste - sold
    const available = current - committed
    const reorderGap = Math.max(0, ingredient.safetyStock - available)

    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      current,
      committed,
      available,
      incoming: ingredient.incoming,
      safetyStock: ingredient.safetyStock,
      reorderGap,
      supplier: ingredient.supplier,
    }
  })
}

export function analyticsSummary(orders: Order[]) {
  const paidOrders = orders.length
  const revenue = orders.reduce((sum, order) => sum + order.total, 0)
  const avgTicket = paidOrders ? revenue / paidOrders : 0
  const readyOrders = orders.filter((order) => order.status === 'ready').length
  const preparingOrders = orders.filter((order) => order.status === 'preparing').length
  return { paidOrders, revenue, avgTicket, readyOrders, preparingOrders }
}
