"use client"

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { BellRing, ChefHat, CreditCard, LayoutGrid, Package, ShoppingCart, Sparkles, Store, Truck } from 'lucide-react'
import { restaurantSeed } from '../lib/demo-data'
import { analyticsSummary, cartTotals, findMenuItem, formatCurrency, inventorySnapshot, lineUnitPrice, selectedOptionLabels, unitLabel } from '../lib/engine'
import type { CartLine, Order, OrderStatus, StockAction } from '../lib/types'

type View = 'customer' | 'kitchen' | 'floor' | 'admin'

function badgeClass(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  return {
    neutral: 'bg-white/10 text-white/80 ring-white/15',
    success: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/20',
    warning: 'bg-amber-400/15 text-amber-100 ring-amber-300/25',
    danger: 'bg-rose-500/15 text-rose-100 ring-rose-400/20',
  }[tone]
}

export function RestaurantOpsDemo({ initialTableId = 't12', initialView = 'customer' }: { initialTableId?: string; initialView?: View }) {
  const [activeView, setActiveView] = useState<View>(initialView)
  const [cart, setCart] = useState<CartLine[]>([])
  const [orders, setOrders] = useState<Order[]>(restaurantSeed.orders)
  const [paymentState, setPaymentState] = useState<'idle' | 'processing' | 'paid'>('idle')
  const [receivedReceipts, setReceivedReceipts] = useState<string[]>([])
  const [stockActions, setStockActions] = useState<StockAction[]>([])

  const currentTable = restaurantSeed.tables.find((table) => table.id === initialTableId)

  if (!currentTable) {
    throw new Error(`Unknown table id: ${initialTableId}`)
  }
  const inventory = useMemo(() => inventorySnapshot(orders, cart, receivedReceipts, stockActions), [orders, cart, receivedReceipts, stockActions])
  const analytics = useMemo(() => analyticsSummary(orders), [orders])
  const totals = useMemo(() => cartTotals(cart), [cart])

  const categories = [...new Set(restaurantSeed.menu.map((item) => item.category))]
  const floorQueue = orders.filter((order) => order.status === 'ready')
  const priorityRank = { high: 0, normal: 1 }
  const kitchenQueue = [...orders].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])

  const lowStock = inventory.filter((item) => item.reorderGap > 0)

  function upsertLine(menuItemId: string) {
    setCart((existing) => {
      const current = existing.find((line) => line.menuItemId === menuItemId)
      if (current) {
        return existing.map((line) => line.menuItemId === menuItemId ? { ...line, quantity: line.quantity + 1 } : line)
      }

      const item = findMenuItem(menuItemId)
      return [...existing, {
        id: `cart-${menuItemId}`,
        menuItemId,
        quantity: 1,
        note: '',
        selectedOptionIds: item.modifierGroups?.flatMap((group) => group.required ? [group.options[0]?.id].filter(Boolean) as string[] : []) ?? [],
      }]
    })
  }

  function mutateLine(lineId: string, patch: Partial<CartLine>) {
    setCart((existing) => existing.map((line) => line.id === lineId ? { ...line, ...patch } : line))
  }

  function removeLine(lineId: string) {
    setCart((existing) => existing.filter((line) => line.id !== lineId))
  }

  function submitPayment() {
    if (!cart.length) return
    setPaymentState('processing')

    const nextOrder: Order = {
      id: `ord-live-${orders.length + 1}`,
      tableId: currentTable.id,
      createdAtLabel: 'Ahora',
      status: 'queued',
      paymentStatus: 'paid',
      priority: totals.total >= 30 ? 'high' : 'normal',
      source: 'web-table',
      guestCount: currentTable.seats,
      total: Number(totals.total.toFixed(2)),
      lines: cart.map((line) => ({
        ...line,
        unitPrice: lineUnitPrice(line),
        itemName: findMenuItem(line.menuItemId).name,
      })),
    }

    setTimeout(() => {
      setOrders((existing) => [nextOrder, ...existing])
      setCart([])
      setPaymentState('paid')
      setActiveView('kitchen')
    }, 500)
  }

  function advanceOrder(orderId: string, status: OrderStatus) {
    setOrders((existing) => existing.map((order) => order.id === orderId ? { ...order, status } : order))
  }

  function receiveReceipt(receiptId: string) {
    setReceivedReceipts((existing) => existing.includes(receiptId) ? existing : [...existing, receiptId])
  }

  function toggleOption(lineId: string, groupId: string, optionId: string, required?: boolean) {
    setCart((existing) => existing.map((line) => {
      if (line.id !== lineId) return line
      const item = findMenuItem(line.menuItemId)
      const group = item.modifierGroups?.find((entry) => entry.id === groupId)
      const groupOptionIds = group?.options.map((option) => option.id) ?? []
      const alreadySelected = line.selectedOptionIds.includes(optionId)

      let next = line.selectedOptionIds.filter((selectedId) => !groupOptionIds.includes(selectedId))
      if (required) {
        next = [...next, optionId]
      } else if (!alreadySelected) {
        next = [...next, ...line.selectedOptionIds.filter((selectedId) => groupOptionIds.includes(selectedId)), optionId]
      } else {
        next = [...next, ...line.selectedOptionIds.filter((selectedId) => groupOptionIds.includes(selectedId) && selectedId !== optionId)]
      }

      return { ...line, selectedOptionIds: Array.from(new Set(next)) }
    }))
  }

  function registerStockAction(action: StockAction) {
    setStockActions((existing) => [...existing, action])
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16),_transparent_28%),linear-gradient(180deg,#09111f_0%,#0f172a_48%,#eef2ff_48%,#f8fafc_100%)] text-slate-950">
      <section className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 text-white shadow-2xl shadow-slate-950/25">
          <div className="grid gap-8 p-6 md:grid-cols-[1.2fr_0.8fr] md:p-10">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.28em] text-cyan-100/80">
                <Sparkles className="h-3.5 w-3.5" />
                Restaurant SaaS MVP · mobile-first dine-in flow
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
                  Pedido desde mesa, cocina conectada e inventario vivo en una sola base de producto.
                </h1>
                <p className="max-w-2xl text-base text-slate-300 md:text-lg">
                  El comensal entra por QR, elige platos, paga online y la orden aterriza en cocina y sala sin toma manual.
                  Cada venta descuenta receta, cada compra repone stock y todo queda trazado para operar un restaurante real.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-slate-200/90">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1 ${badgeClass('success')}`}><Store className="h-4 w-4" /> {restaurantSeed.restaurant.name}</span>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1 ${badgeClass('neutral')}`}>{currentTable.label} · {currentTable.zone}</span>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1 ${badgeClass('neutral')}`}>QR {currentTable.qrPath}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'Pedidos pagados', value: analytics.paidOrders, sub: 'confirmados online' },
                  { label: 'Facturación demo', value: formatCurrency(analytics.revenue), sub: 'servicio actual' },
                  { label: 'Reposición crítica', value: lowStock.length, sub: 'ingredientes bajo mínimo' },
                ].map((card) => (
                  <div key={card.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{card.label}</div>
                    <div className="mt-2 text-2xl font-semibold">{card.value}</div>
                    <div className="mt-1 text-sm text-slate-300">{card.sub}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 to-violet-500/10 p-5">
              <div className="text-sm font-medium text-cyan-100">Flujo principal modelado</div>
              <ol className="mt-4 space-y-3 text-sm text-slate-200">
                {[
                  'Cliente entra desde móvil y ya viene contextualizado por mesa/QR.',
                  'Explora carta, añade observaciones y configura producto.',
                  'Checkout modela pago online y genera orden pagada.',
                  'Cocina recibe cola priorizada por mesa y estado.',
                  'Sala entrega sólo pedidos marcados como listos.',
                  'Recetas descuentan stock; compras pendientes reponen inventario.',
                ].map((step, idx) => (
                  <li key={step} className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs">{idx + 1}</span><span>{step}</span></li>
                ))}
              </ol>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <Link href="/restaurant" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center font-medium text-white transition hover:bg-white/10">Vista ejecutiva</Link>
                <button onClick={() => setActiveView('customer')} className="rounded-2xl bg-cyan-300 px-4 py-3 text-center font-semibold text-slate-950 transition hover:bg-cyan-200">Abrir demo operativa</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto -mt-8 max-w-7xl px-4 pb-12 md:px-6">
        <div className="rounded-[32px] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Workspace operativo</div>
              <h2 className="text-2xl font-semibold text-slate-950">Mesa, cocina, sala y backoffice en un solo tablero revisable</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ['customer', 'Cliente en mesa', ShoppingCart],
                ['kitchen', 'Cocina', ChefHat],
                ['floor', 'Sala', BellRing],
                ['admin', 'Admin + inventario', LayoutGrid],
              ].map(([value, label, Icon]) => {
                const typedValue = value as View
                return (
                  <button
                    key={value}
                    onClick={() => setActiveView(typedValue)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${activeView === typedValue ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-6">
              {activeView === 'customer' && (
                <section className="space-y-5">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Experiencia cliente</div>
                        <h3 className="text-2xl font-semibold">{currentTable.label} · carta digital del local</h3>
                        <p className="mt-1 text-sm text-slate-600">El sistema conoce la mesa, evita errores de entrega y modela el pedido online desde móvil.</p>
                      </div>
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        Pago {paymentState === 'paid' ? 'confirmado' : paymentState === 'processing' ? 'procesando' : 'pendiente'}
                      </div>
                    </div>
                  </div>

                  {categories.map((category) => (
                    <div key={category} className="space-y-3">
                      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{category}</div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {restaurantSeed.menu.filter((item) => item.category === category).map((item) => (
                          <article key={item.id} className="rounded-[24px] border border-slate-200 p-5 shadow-sm shadow-slate-900/5">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="text-lg font-semibold">{item.name}</h4>
                                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                              </div>
                              <div className="text-right font-semibold text-slate-950">{formatCurrency(item.price)}</div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                              <span className="rounded-full bg-slate-100 px-2 py-1">{item.prepMinutes} min</span>
                              {item.tags.map((tag) => <span key={tag} className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{tag}</span>)}
                            </div>
                            <button onClick={() => upsertLine(item.id)} className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Añadir al carrito</button>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {activeView === 'kitchen' && (
                <section className="space-y-4">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Kitchen display system</div>
                        <h3 className="text-2xl font-semibold">Cola priorizada por mesa, estado y urgencia</h3>
                      </div>
                      <div className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{analytics.preparingOrders} en preparación · {analytics.readyOrders} listas</div>
                    </div>
                  </div>
                  <div className="grid gap-4">
                    {kitchenQueue.map((order) => (
                      <article key={order.id} className="rounded-[24px] border border-slate-200 p-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{order.createdAtLabel} · {restaurantSeed.tables.find((table) => table.id === order.tableId)?.label}</div>
                            <h4 className="text-xl font-semibold">Orden {order.id}</h4>
                          </div>
                          <div className={`rounded-full px-3 py-1 text-sm ring-1 ${order.priority === 'high' ? badgeClass('danger') : badgeClass('warning')}`}>{order.priority === 'high' ? 'Alta prioridad' : 'Normal'}</div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {order.lines.map((line) => (
                            <div key={line.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <div className="font-medium">{line.quantity} × {line.itemName}</div>
                                  {selectedOptionLabels(line).length ? <div className="text-sm text-slate-500">Config: {selectedOptionLabels(line).join(', ')}</div> : null}
                                  {line.note ? <div className="text-sm text-slate-500">Obs: {line.note}</div> : null}
                                </div>
                                <div className="text-sm text-slate-500">{findMenuItem(line.menuItemId).prepMinutes} min</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {order.status === 'queued' && <button onClick={() => advanceOrder(order.id, 'preparing')} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Empezar</button>}
                          {order.status === 'preparing' && <button onClick={() => advanceOrder(order.id, 'ready')} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Marcar lista</button>}
                          {order.status === 'ready' && <span className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">Esperando entrega en sala</span>}
                          {order.status === 'served' && <span className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">Servida</span>}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {activeView === 'floor' && (
                <section className="space-y-4">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Sala / camareros</div>
                    <h3 className="text-2xl font-semibold">Entrega guiada por mesa correcta</h3>
                    <p className="mt-1 text-sm text-slate-600">El equipo de sala sólo ve lo que cocina ya marcó como listo y la mesa destino.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {floorQueue.map((order) => {
                      const table = restaurantSeed.tables.find((item) => item.id === order.tableId)
                      return (
                        <article key={order.id} className="rounded-[24px] border border-slate-200 p-5 shadow-sm">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Pickup ready</div>
                          <h4 className="mt-2 text-xl font-semibold">{table?.label} · {table?.zone}</h4>
                          <p className="mt-1 text-sm text-slate-600">{order.lines.map((line) => `${line.quantity}× ${line.itemName}`).join(' · ')}</p>
                          <div className="mt-4 flex items-center justify-between">
                            <span className="text-sm text-slate-500">Pago confirmado · ticket {formatCurrency(order.total)}</span>
                            <button onClick={() => advanceOrder(order.id, 'served')} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Entregado</button>
                          </div>
                        </article>
                      )
                    })}
                    {!floorQueue.length && (
                      <div className="rounded-[24px] border border-dashed border-slate-300 p-8 text-center text-slate-500">No hay platos listos ahora mismo.</div>
                    )}
                  </div>
                </section>
              )}

              {activeView === 'admin' && (
                <section className="space-y-5">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Backoffice operativo</div>
                    <h3 className="text-2xl font-semibold">Inventario, recetas, compras y analítica listos para iterar a SaaS real</h3>
                    <p className="mt-1 text-sm text-slate-600">MVP pragmático: descuenta receta al cobrar; usa cart activo como stock comprometido y registra reposición desde facturas proveedor.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {[
                      { label: 'Ticket medio', value: formatCurrency(analytics.avgTicket), icon: CreditCard },
                      { label: 'Órdenes listas', value: analytics.readyOrders, icon: BellRing },
                      { label: 'Compras pendientes', value: restaurantSeed.purchaseReceipts.filter((receipt) => !receivedReceipts.includes(receipt.id)).length, icon: Truck },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} className="rounded-[24px] border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center gap-3 text-slate-500"><Icon className="h-4 w-4" /> {label}</div>
                        <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <aside className="space-y-6">
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Carrito / pedido actual</div>
                    <h3 className="text-xl font-semibold">Mesa identificada automáticamente</h3>
                  </div>
                  <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{currentTable.label}</div>
                </div>
                <div className="mt-4 space-y-3">
                  {cart.map((line) => {
                    const item = findMenuItem(line.menuItemId)
                    return (
                      <div key={line.id} className="rounded-2xl bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-sm text-slate-500">{formatCurrency(lineUnitPrice(line))} por unidad</div>
                          </div>
                          <button onClick={() => removeLine(line.id)} className="text-sm text-rose-600">Quitar</button>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <input value={line.note} onChange={(event) => mutateLine(line.id, { note: event.target.value })} placeholder="Observaciones" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                          <div className="flex items-center gap-2">
                            <button onClick={() => mutateLine(line.id, { quantity: Math.max(1, line.quantity - 1) })} className="h-9 w-9 rounded-full bg-slate-100">−</button>
                            <span className="min-w-5 text-center font-medium">{line.quantity}</span>
                            <button onClick={() => mutateLine(line.id, { quantity: line.quantity + 1 })} className="h-9 w-9 rounded-full bg-slate-100">+</button>
                          </div>
                        </div>
                        {item.modifierGroups?.length ? (
                          <div className="mt-3 space-y-2">
                            {item.modifierGroups.map((group) => (
                              <div key={group.id}>
                                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">{group.label}</div>
                                <div className="flex flex-wrap gap-2">
                                  {group.options.map((option) => {
                                    const active = line.selectedOptionIds.includes(option.id)
                                    return (
                                      <button
                                        key={option.id}
                                        onClick={() => toggleOption(line.id, group.id, option.id, group.required)}
                                        className={`rounded-full px-3 py-1.5 text-xs transition ${active ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                                      >
                                        {option.label}{option.priceDelta ? ` (+${formatCurrency(option.priceDelta)})` : ''}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  {!cart.length && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Añade platos para ver checkout, stock comprometido y paso a cocina.</div>}
                </div>
                <div className="mt-4 space-y-2 rounded-2xl bg-slate-950 p-4 text-white">
                  <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
                  <div className="flex justify-between text-sm"><span>Fee checkout</span><span>{formatCurrency(totals.serviceFee)}</span></div>
                  <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
                  <button disabled={!cart.length || paymentState === 'processing'} onClick={submitPayment} className="mt-3 w-full rounded-2xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">{paymentState === 'processing' ? 'Validando pago online…' : 'Pagar y enviar a cocina'}</button>
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500"><Package className="h-4 w-4" /><span className="text-xs uppercase tracking-[0.18em]">Inventario inteligente</span></div>
                <h3 className="mt-2 text-xl font-semibold">Stock disponible, comprometido y reposición</h3>
                <div className="mt-4 space-y-3">
                  {inventory.slice(0, 6).map((item) => (
                    <div key={item.ingredientId} className="rounded-2xl bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-sm text-slate-500">Proveedor: {item.supplier}</div>
                        </div>
                        {item.reorderGap > 0 ? <span className={`rounded-full px-3 py-1 text-xs ring-1 ${badgeClass('danger')}`}>Reponer {item.reorderGap} {unitLabel(item.unit)}</span> : <span className={`rounded-full px-3 py-1 text-xs ring-1 ${badgeClass('success')}`}>OK</span>}
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
                        <div><div className="text-slate-400">Actual</div><div className="font-medium">{item.current} {unitLabel(item.unit)}</div></div>
                        <div><div className="text-slate-400">Comprom.</div><div className="font-medium">{item.committed} {unitLabel(item.unit)}</div></div>
                        <div><div className="text-slate-400">Disponible</div><div className="font-medium">{item.available} {unitLabel(item.unit)}</div></div>
                        <div><div className="text-slate-400">Entrante</div><div className="font-medium">{item.incoming} {unitLabel(item.unit)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500"><Truck className="h-4 w-4" /><span className="text-xs uppercase tracking-[0.18em]">Compras proveedor</span></div>
                <h3 className="mt-2 text-xl font-semibold">Entrada de stock por factura</h3>
                <div className="mt-4 space-y-3">
                  {restaurantSeed.purchaseReceipts.map((receipt) => {
                    const received = receivedReceipts.includes(receipt.id)
                    return (
                      <div key={receipt.id} className="rounded-2xl bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{receipt.reference}</div>
                            <div className="text-sm text-slate-500">{receipt.supplier}</div>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs ring-1 ${received ? badgeClass('success') : badgeClass('warning')}`}>{received ? 'Recibida' : 'Pendiente'}</span>
                        </div>
                        <div className="mt-3 text-sm text-slate-600">{receipt.entries.map((entry) => {
                          const ingredient = restaurantSeed.ingredients.find((item) => item.id === entry.ingredientId)
                          return `${ingredient?.name}: +${entry.quantity} ${unitLabel(ingredient?.unit ?? 'unit')}`
                        }).join(' · ')}</div>
                        <button disabled={received} onClick={() => receiveReceipt(receipt.id)} className="mt-4 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Registrar factura y reponer stock</button>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Recetas / escandallos</div>
                <h3 className="mt-2 text-xl font-semibold">Trazabilidad venta → receta → consumo</h3>
                <div className="mt-4 space-y-3">
                  {restaurantSeed.menu.slice(0, 3).map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                      <div className="font-medium">{item.name}</div>
                      <div className="mt-2 text-sm text-slate-600">{item.recipe.map((entry) => {
                        const ingredient = restaurantSeed.ingredients.find((candidate) => candidate.id === entry.ingredientId)
                        return `${ingredient?.name}: ${entry.quantity} ${unitLabel(entry.unit)}`
                      }).join(' · ')}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Mermas y ajustes</div>
                <h3 className="mt-2 text-xl font-semibold">Operaciones manuales de stock del MVP</h3>
                <div className="mt-4 grid gap-3">
                  <button onClick={() => registerStockAction({ ingredientId: 'orange', quantity: 3, type: 'waste', reason: 'Merma en barra' })} className="rounded-2xl bg-amber-50 px-4 py-3 text-left text-sm font-medium text-amber-800">Registrar merma: 3 naranjas perdidas en barra</button>
                  <button onClick={() => registerStockAction({ ingredientId: 'pesto', quantity: 120, type: 'adjustment', reason: 'Ajuste por conteo' })} className="rounded-2xl bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-800">Ajuste manual: +120 g de pesto tras conteo</button>
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Eventos registrados: {stockActions.length}. En una siguiente fase deberían persistirse como ledger auditable por usuario y turno.</div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  )
}
