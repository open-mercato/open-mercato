import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@/lib/di/container'
import {
  SalesOrder,
  SalesOrderLine,
  SalesOrderAdjustment,
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
  SalesShipment,
  SalesShipmentItem,
  SalesPayment,
  SalesPaymentAllocation,
  SalesDocumentAddress,
  SalesNote,
  SalesChannel,
  SalesPaymentMethod,
  SalesShippingMethod,
  type SalesAdjustmentKind,
  type SalesLineKind,
} from '../data/entities'
import { seedSalesDictionaries } from '../lib/dictionaries'
import { toNumericString } from '../commands/shared'
import type { SalesCalculationService } from '../services/salesCalculationService'
import { ensureExamplePaymentMethods, ensureExampleShippingMethods, type SeedScope } from './examples-data'

type ExampleAddress = {
  role: 'billing' | 'shipping'
  companyName?: string
  name?: string
  addressLine1: string
  addressLine2?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  latitude?: number
  longitude?: number
}

type ExampleLine = {
  kind?: SalesLineKind
  name: string
  description?: string
  quantity: number
  unitPriceNet: number
  unitPriceGross?: number
  taxRate?: number
  discountPercent?: number
  quantityUnit?: string
  comment?: string
}

type ExampleAdjustment = {
  scope: 'order' | 'line'
  kind: SalesAdjustmentKind
  label?: string
  amountNet: number
  amountGross?: number
  rate?: number
  lineIndex?: number
  position?: number
}

type ExampleNote = {
  body: string
  createdAt?: Date
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type ExampleShipment = {
  shipmentNumber?: string
  methodCode?: string
  status?: string
  shippedAt?: Date
  deliveredAt?: Date
  trackingNumbers?: string[]
  weightKg?: number
  declaredValue?: number
  currencyCode?: string
  notes?: string
  items: Array<{ lineIndex: number; quantity: number }>
}

type ExamplePayment = {
  reference?: string
  methodCode?: string
  status?: string
  amount: number
  currencyCode: string
  receivedAt?: Date
  capturedAt?: Date
}

type ExampleQuote = {
  quoteNumber: string
  status?: string
  comments?: string
  validFrom?: Date
  validUntil?: Date
  currencyCode: string
  shippingMethodCode?: string
  paymentMethodCode?: string
  addresses?: ExampleAddress[]
  lines: ExampleLine[]
  adjustments?: ExampleAdjustment[]
  notes?: ExampleNote[]
  metadata?: Record<string, unknown>
  channelCode?: string
}

type ExampleOrder = {
  orderNumber: string
  status?: string
  fulfillmentStatus?: string
  paymentStatus?: string
  comments?: string
  internalNotes?: string
  placedAt?: Date
  expectedDeliveryAt?: Date
  currencyCode: string
  shippingMethodCode?: string
  paymentMethodCode?: string
  channelCode?: string
  addresses?: ExampleAddress[]
  lines: ExampleLine[]
  adjustments?: ExampleAdjustment[]
  notes?: ExampleNote[]
  shipments?: ExampleShipment[]
  payments?: ExamplePayment[]
  metadata?: Record<string, unknown>
}

const CHANNEL_SEEDS = [
  { code: 'online', name: 'Online Store', description: 'Orders captured from the storefront.' },
  {
    code: 'field-sales',
    name: 'Field Sales',
    description: 'Quotes negotiated by the sales team and converted offline.',
  },
] as const

const QUOTE_SEEDS: ExampleQuote[] = [
  {
    quoteNumber: 'SQ-DEMO-1001',
    status: 'draft',
    comments: 'Pricing reflects bundled onboarding; valid for 30 days.',
    validFrom: daysFromNow(-2),
    validUntil: daysFromNow(28),
    currencyCode: 'USD',
    shippingMethodCode: 'express-air',
    paymentMethodCode: 'bank-transfer',
    channelCode: 'field-sales',
    lines: [
      {
        name: 'Remote onboarding package',
        description: 'Kick-off, workflow design, and training for distributed teams.',
        quantity: 1,
        unitPriceNet: 180,
        taxRate: 10,
      },
      {
        name: 'Implementation workshop (4h)',
        description: 'Hands-on configuration session with stakeholders.',
        quantity: 1,
        unitPriceNet: 320,
        taxRate: 0,
        comment: 'Can be split into two shorter sessions on request.',
      },
    ],
    adjustments: [
      { scope: 'order', kind: 'discount', label: 'Pilot discount', amountNet: 45, position: 1 },
      {
        scope: 'order',
        kind: 'shipping',
        label: 'Expedited shipping',
        amountNet: 25,
        amountGross: 27.5,
        position: 2,
      },
    ],
    addresses: [
      {
        role: 'billing',
        companyName: 'Northwind Ventures',
        name: 'Nora Winters',
        addressLine1: '200 Pine St',
        addressLine2: 'Suite 900',
        city: 'Seattle',
        region: 'WA',
        postalCode: '98101',
        country: 'US',
      },
      {
        role: 'shipping',
        companyName: 'Northwind Ventures',
        name: 'Receiving Dock',
        addressLine1: '4124 4th Ave S',
        city: 'Seattle',
        region: 'WA',
        postalCode: '98134',
        country: 'US',
      },
    ],
    notes: [
      {
        body: 'Requested weekend training option if schedules slip.',
        createdAt: daysFromNow(-1),
        appearanceIcon: 'lucide:calendar-clock',
        appearanceColor: '#0ea5e9',
      },
      {
        body: 'Prefers invoicing after acceptance instead of deposit.',
        createdAt: daysFromNow(0),
        appearanceIcon: 'lucide:receipt',
        appearanceColor: '#f97316',
      },
    ],
    metadata: { seed: 'sales.examples' },
  },
]

const ORDER_SEEDS: ExampleOrder[] = [
  {
    orderNumber: 'SO-DEMO-2001',
    status: 'confirmed',
    fulfillmentStatus: 'in_fulfillment',
    comments: 'White-glove delivery requested for the larger items.',
    internalNotes: 'Coordinate with facilities for access badges.',
    placedAt: daysFromNow(-3),
    expectedDeliveryAt: daysFromNow(4),
    currencyCode: 'USD',
    shippingMethodCode: 'standard-ground',
    paymentMethodCode: 'card',
    channelCode: 'online',
    lines: [
      {
        name: 'Modular desk system',
        quantity: 1,
        unitPriceNet: 640,
        taxRate: 10,
        description: 'Corner configuration with cable routing.',
      },
      {
        name: 'Acoustic panel set',
        quantity: 3,
        unitPriceNet: 85,
        taxRate: 10,
        description: 'Charcoal grey finish, adhesive mount.',
        discountPercent: 5,
      },
    ],
    adjustments: [
      {
        scope: 'order',
        kind: 'shipping',
        label: 'White-glove delivery',
        amountNet: 60,
        amountGross: 66,
        position: 1,
      },
      { scope: 'order', kind: 'discount', label: 'New office promo', amountNet: 75, position: 2 },
      {
        scope: 'order',
        kind: 'surcharge',
        label: 'After-hours install',
        amountNet: 35,
        amountGross: 38.5,
        position: 3,
      },
    ],
    shipments: [
      {
        shipmentNumber: 'SHIP-2001-1',
        methodCode: 'standard-ground',
        status: 'shipped',
        shippedAt: daysFromNow(-1),
        trackingNumbers: ['1Z-234-ACOUSTICS'],
        weightKg: 38,
        declaredValue: 720,
        currencyCode: 'USD',
        notes: 'Panels shipped separately to avoid freight delay.',
        items: [
          { lineIndex: 1, quantity: 2 },
        ],
      },
      {
        shipmentNumber: 'SHIP-2001-2',
        methodCode: 'express-air',
        status: 'in_transit',
        shippedAt: daysFromNow(0),
        trackingNumbers: ['1Z-987-DESK'],
        weightKg: 72,
        declaredValue: 560,
        currencyCode: 'USD',
        notes: 'Desk ships via express due to size.',
        items: [{ lineIndex: 0, quantity: 1 }],
      },
    ],
    payments: [
      {
        reference: 'AUTH-2001-CC',
        methodCode: 'card',
        status: 'captured',
        amount: 600,
        currencyCode: 'USD',
        receivedAt: daysFromNow(-2),
        capturedAt: daysFromNow(-1),
      },
      {
        reference: 'WIRE-2001',
        methodCode: 'bank-transfer',
        status: 'received',
        amount: 414,
        currencyCode: 'USD',
        receivedAt: daysFromNow(1),
      },
    ],
    addresses: [
      {
        role: 'billing',
        companyName: 'Harborview Analytics',
        name: 'Accounts Payable',
        addressLine1: '355 Atlantic Ave Floor 6',
        city: 'Boston',
        region: 'MA',
        postalCode: '02210',
        country: 'US',
      },
      {
        role: 'shipping',
        companyName: 'Harborview Analytics',
        name: 'Loading Dock',
        addressLine1: '9 Drydock Ave',
        city: 'Boston',
        region: 'MA',
        postalCode: '02210',
        country: 'US',
      },
    ],
    notes: [
      {
        body: 'Facilities requested 2-hour delivery window notice.',
        createdAt: daysFromNow(-2),
        appearanceIcon: 'lucide:bell-ring',
        appearanceColor: '#0ea5e9',
      },
      {
        body: 'Panels can be staged in conference room A.',
        createdAt: daysFromNow(-1),
        appearanceIcon: 'lucide:warehouse',
        appearanceColor: '#22c55e',
      },
    ],
    metadata: { seed: 'sales.examples' },
  },
  {
    orderNumber: 'SO-DEMO-2002',
    status: 'confirmed',
    fulfillmentStatus: 'fulfilled',
    paymentStatus: 'partial',
    comments: 'Subscription setup aligns with fiscal Q3 start.',
    placedAt: daysFromNow(-6),
    expectedDeliveryAt: daysFromNow(1),
    currencyCode: 'USD',
    shippingMethodCode: 'express-air',
    paymentMethodCode: 'bank-transfer',
    channelCode: 'field-sales',
    lines: [
      {
        name: 'On-site enablement',
        quantity: 1,
        unitPriceNet: 280,
        taxRate: 0,
        description: 'Day of workshops across two teams.',
      },
      {
        name: 'Support retainer (Q3)',
        quantity: 1,
        unitPriceNet: 180,
        taxRate: 0,
        description: 'Response SLA with named TAM.',
      },
    ],
    adjustments: [
      {
        scope: 'order',
        kind: 'shipping',
        label: 'Travel & lodging',
        amountNet: 20,
        amountGross: 22,
        position: 1,
      },
      {
        scope: 'order',
        kind: 'discount',
        label: 'Multi-team starter',
        amountNet: 25,
        position: 2,
      },
    ],
    shipments: [
      {
        shipmentNumber: 'SHIP-2002-1',
        methodCode: 'express-air',
        status: 'delivered',
        shippedAt: daysFromNow(-4),
        deliveredAt: daysFromNow(-2),
        trackingNumbers: ['AIR-22002-KIT'],
        declaredValue: 150,
        currencyCode: 'USD',
        notes: 'Enablement kit delivered to training room.',
        items: [
          { lineIndex: 0, quantity: 1 },
          { lineIndex: 1, quantity: 1 },
        ],
      },
    ],
    payments: [
      {
        reference: 'WIRE-2002',
        methodCode: 'bank-transfer',
        status: 'received',
        amount: 250,
        currencyCode: 'USD',
        receivedAt: daysFromNow(-1),
      },
    ],
    addresses: [
      {
        role: 'billing',
        companyName: 'Brightside Solar',
        name: 'Finance',
        addressLine1: '245 Market St Suite 400',
        city: 'San Francisco',
        region: 'CA',
        postalCode: '94105',
        country: 'US',
      },
      {
        role: 'shipping',
        companyName: 'Brightside Solar',
        name: 'Training Room B',
        addressLine1: '245 Market St Suite 410',
        city: 'San Francisco',
        region: 'CA',
        postalCode: '94105',
        country: 'US',
      },
    ],
    notes: [
      {
        body: 'TAM onboarding scheduled next Tuesday.',
        createdAt: daysFromNow(-3),
        appearanceIcon: 'lucide:users',
        appearanceColor: '#a855f7',
      },
      {
        body: 'Retainer renewal review in mid-Q4.',
        createdAt: daysFromNow(-2),
        appearanceIcon: 'lucide:clock-3',
        appearanceColor: '#f97316',
      },
    ],
    metadata: { seed: 'sales.examples' },
  },
]

function daysFromNow(offset: number): Date {
  const now = new Date()
  const copy = new Date(now)
  copy.setUTCDate(now.getUTCDate() + offset)
  return copy
}

function toAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0'
  return toNumericString(Math.round((value + Number.EPSILON) * 10000) / 10000) ?? '0'
}

function toSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function ensureChannels(
  em: EntityManager,
  scope: SeedScope
): Promise<Map<string, SalesChannel>> {
  const existing = await em.find(SalesChannel, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const map = new Map<string, SalesChannel>()
  existing.forEach((entry) => map.set((entry.code ?? '').toLowerCase(), entry))
  const now = new Date()
  for (const seed of CHANNEL_SEEDS) {
    const code = seed.code.toLowerCase()
    if (map.has(code)) continue
    const record = em.create(SalesChannel, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: seed.name,
      code: seed.code,
      description: seed.description,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    map.set(code, record)
  }
  return map
}

function buildAddressSnapshot(address: ExampleAddress) {
  return {
    companyName: address.companyName ?? null,
    name: address.name ?? null,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
  }
}

function buildShippingMethodSnapshot(method?: SalesShippingMethod | null) {
  if (!method) return null
  return {
    id: method.id,
    code: method.code,
    name: method.name,
    providerKey: method.providerKey ?? null,
    serviceLevel: method.serviceLevel ?? null,
    estimatedTransitDays: method.estimatedTransitDays ?? null,
    baseRateNet: method.baseRateNet,
    baseRateGross: method.baseRateGross,
    currencyCode: method.currencyCode,
    metadata: method.metadata ?? null,
  }
}

function buildPaymentMethodSnapshot(method?: SalesPaymentMethod | null) {
  if (!method) return null
  return {
    id: method.id,
    code: method.code,
    name: method.name,
    providerKey: method.providerKey ?? null,
    terms: method.terms ?? null,
    metadata: method.metadata ?? null,
  }
}

function attachDocumentAddresses(
  em: EntityManager,
  params: {
    documentId: string
    documentKind: 'order' | 'quote'
    addresses: ExampleAddress[]
    order?: SalesOrder
    quote?: SalesQuote
  }
) {
  const { documentId, documentKind, addresses, order, quote } = params
  for (const entry of addresses) {
    const record = em.create(SalesDocumentAddress, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      documentId,
      documentKind,
      customerAddressId: null,
      name: entry.name ?? null,
      companyName: entry.companyName ?? null,
      purpose: entry.role,
      addressLine1: entry.addressLine1,
      addressLine2: entry.addressLine2 ?? null,
      city: entry.city ?? null,
      region: entry.region ?? null,
      postalCode: entry.postalCode ?? null,
      country: entry.country ?? null,
      latitude: entry.latitude ?? null,
      longitude: entry.longitude ?? null,
      buildingNumber: null,
      flatNumber: null,
      order: documentKind === 'order' ? order ?? null : null,
      quote: documentKind === 'quote' ? quote ?? null : null,
    })
    em.persist(record)
  }
}

function attachNotes(
  em: EntityManager,
  params: {
    contextId: string
    contextType: 'order' | 'quote'
    notes: ExampleNote[]
    order?: SalesOrder
    quote?: SalesQuote
  }
) {
  const { contextId, contextType, notes, order, quote } = params
  for (const note of notes) {
    const record = em.create(SalesNote, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      contextType,
      contextId,
      body: note.body,
      appearanceIcon: note.appearanceIcon ?? null,
      appearanceColor: note.appearanceColor ?? null,
      createdAt: note.createdAt ?? new Date(),
      updatedAt: note.createdAt ?? new Date(),
    })
    record.order = contextType === 'order' ? order ?? null : null
    record.quote = contextType === 'quote' ? quote ?? null : null
    em.persist(record)
  }
}

function mapPaymentStatus(outstanding: number): string | null {
  if (outstanding <= 0.01) return 'paid'
  if (outstanding > 0) return 'partial'
  return null
}

export async function seedSalesExamples(
  em: EntityManager,
  container: AppContainer,
  scope: SeedScope
): Promise<boolean> {
  const hasOrders =
    ORDER_SEEDS.length > 0
      ? await em.count(SalesOrder, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          orderNumber: { $in: ORDER_SEEDS.map((item) => item.orderNumber) as any },
        })
      : 0
  const hasQuotes =
    QUOTE_SEEDS.length > 0
      ? await em.count(SalesQuote, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          quoteNumber: { $in: QUOTE_SEEDS.map((item) => item.quoteNumber) as any },
        })
      : 0

  if (hasOrders > 0 || hasQuotes > 0) {
    return false
  }

  await seedSalesDictionaries(em, scope)
  const [shippingMethods, paymentMethods, channels] = await Promise.all([
    ensureExampleShippingMethods(em, scope, { skipFlush: true }),
    ensureExamplePaymentMethods(em, scope, { skipFlush: true }),
    ensureChannels(em, scope),
  ])
  await em.flush()

  const calculationService = container.resolve<SalesCalculationService>('salesCalculationService')

  for (const seed of QUOTE_SEEDS) {
    const quoteId = randomUUID()
    const shippingMethod = seed.shippingMethodCode
      ? shippingMethods.get(seed.shippingMethodCode.toLowerCase()) ?? null
      : null
    const paymentMethod = seed.paymentMethodCode
      ? paymentMethods.get(seed.paymentMethodCode.toLowerCase()) ?? null
      : null
    const channel = seed.channelCode ? channels.get(seed.channelCode.toLowerCase()) ?? null : null

    const lineSnapshots = seed.lines.map((line) => ({
      id: randomUUID(),
      kind: line.kind ?? 'product',
      name: line.name,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      currencyCode: seed.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross ?? null,
      taxRate: line.taxRate ?? 0,
      discountPercent: line.discountPercent ?? null,
    }))

    const adjustmentDrafts =
      seed.adjustments?.map((adj) => ({
        id: randomUUID(),
        scope: adj.scope,
        kind: adj.kind,
        code: adj.label ?? null,
        label: adj.label ?? null,
        rate: adj.rate ?? null,
        amountNet: adj.amountNet,
        amountGross: adj.amountGross ?? adj.amountNet,
        currencyCode: seed.currencyCode,
        position: adj.position ?? 0,
        metadata: adj.lineIndex !== undefined ? { lineIndex: adj.lineIndex } : null,
      })) ?? []

    const calculation = await calculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        currencyCode: seed.currencyCode,
      },
    })

    const quote = em.create(SalesQuote, {
      id: quoteId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      quoteNumber: seed.quoteNumber,
      status: seed.status ?? 'draft',
      customerEntityId: null,
      customerContactId: null,
      currencyCode: seed.currencyCode,
      validFrom: seed.validFrom ?? null,
      validUntil: seed.validUntil ?? null,
      comments: seed.comments ?? null,
      shippingMethodId: shippingMethod?.id ?? null,
      shippingMethodCode: shippingMethod?.code ?? seed.shippingMethodCode ?? null,
      paymentMethodId: paymentMethod?.id ?? null,
      paymentMethodCode: paymentMethod?.code ?? seed.paymentMethodCode ?? null,
      channelId: channel?.id ?? null,
      shippingMethodSnapshot: buildShippingMethodSnapshot(shippingMethod),
      paymentMethodSnapshot: buildPaymentMethodSnapshot(paymentMethod),
      metadata: seed.metadata ?? { seed: 'sales.examples' },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(quote)

    calculation.lines.forEach((lineResult, idx) => {
      const source = lineSnapshots[idx]
      const line = em.create(SalesQuoteLine, {
        id: source.id,
        quote,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineNumber: idx + 1,
        kind: source.kind ?? 'product',
        name: source.name,
        description: source.description,
        comment: source.comment,
        quantity: toAmount(source.quantity),
        quantityUnit: source.quantityUnit ?? null,
        currencyCode: source.currencyCode,
        unitPriceNet: toAmount(source.unitPriceNet ?? 0),
        unitPriceGross: toAmount(source.unitPriceGross ?? source.unitPriceNet ?? 0),
        discountAmount: toAmount(lineResult.discountAmount),
        discountPercent:
          source.discountPercent !== null && source.discountPercent !== undefined
            ? toAmount(source.discountPercent)
            : '0',
        taxRate: toAmount(source.taxRate ?? 0),
        taxAmount: toAmount(lineResult.taxAmount),
        totalNetAmount: toAmount(lineResult.netAmount),
        totalGrossAmount: toAmount(lineResult.grossAmount),
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(line)
    })

    calculation.adjustments.forEach((adj, idx) => {
      const lineIndex = adj.metadata && typeof adj.metadata === 'object' ? (adj.metadata as any).lineIndex : null
      const lineRef =
        typeof lineIndex === 'number' && lineIndex >= 0 && lineIndex < seed.lines.length
          ? lineSnapshots[lineIndex]?.id ?? null
          : null
      const adjustment = em.create(SalesQuoteAdjustment, {
        id: adj.id ?? randomUUID(),
        quote,
        quoteLine: lineRef ? (lineRef as unknown as SalesQuoteLine) : null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        scope: adj.scope,
        kind: adj.kind,
        code: adj.code ?? adj.label ?? null,
        label: adj.label ?? adj.code ?? null,
        calculatorKey: adj.calculatorKey ?? null,
        promotionId: adj.promotionId ?? null,
        rate: adj.rate !== null && adj.rate !== undefined ? toAmount(adj.rate) : '0',
        amountNet: toAmount(adj.amountNet ?? 0),
        amountGross: toAmount(adj.amountGross ?? adj.amountNet ?? 0),
        currencyCode: adj.currencyCode ?? seed.currencyCode,
        metadata: adj.metadata ?? null,
        position: adj.position ?? idx,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(adjustment)
    })

    quote.subtotalNetAmount = toAmount(calculation.totals.subtotalNetAmount)
    quote.subtotalGrossAmount = toAmount(calculation.totals.subtotalGrossAmount)
    quote.discountTotalAmount = toAmount(calculation.totals.discountTotalAmount)
    quote.taxTotalAmount = toAmount(calculation.totals.taxTotalAmount)
    quote.grandTotalNetAmount = toAmount(calculation.totals.grandTotalNetAmount)
    quote.grandTotalGrossAmount = toAmount(calculation.totals.grandTotalGrossAmount)
    quote.totalsSnapshot = toSnapshot(calculation.totals)
    quote.lineItemCount = seed.lines.length

    if (seed.addresses?.length) {
      attachDocumentAddresses(em, {
        documentId: quoteId,
        documentKind: 'quote',
        addresses: seed.addresses,
        quote,
      })
      const billing = seed.addresses.find((a) => a.role === 'billing')
      const shipping = seed.addresses.find((a) => a.role === 'shipping')
      quote.billingAddressSnapshot = billing ? buildAddressSnapshot(billing) : null
      quote.shippingAddressSnapshot = shipping ? buildAddressSnapshot(shipping) : null
    }
    if (seed.notes?.length) {
      attachNotes(em, {
        contextId: quoteId,
        contextType: 'quote',
        notes: seed.notes,
        quote,
      })
    }
  }

  for (const seed of ORDER_SEEDS) {
    const orderId = randomUUID()
    const shippingMethod = seed.shippingMethodCode
      ? shippingMethods.get(seed.shippingMethodCode.toLowerCase()) ?? null
      : null
    const paymentMethod = seed.paymentMethodCode
      ? paymentMethods.get(seed.paymentMethodCode.toLowerCase()) ?? null
      : null
    const channel = seed.channelCode ? channels.get(seed.channelCode.toLowerCase()) ?? null : null

    const lineSnapshots = seed.lines.map((line) => ({
      id: randomUUID(),
      kind: line.kind ?? 'product',
      name: line.name,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      currencyCode: seed.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross ?? null,
      taxRate: line.taxRate ?? 0,
      discountPercent: line.discountPercent ?? null,
    }))

    const adjustmentDrafts =
      seed.adjustments?.map((adj) => ({
        id: randomUUID(),
        scope: adj.scope,
        kind: adj.kind,
        code: adj.label ?? null,
        label: adj.label ?? null,
        rate: adj.rate ?? null,
        amountNet: adj.amountNet,
        amountGross: adj.amountGross ?? adj.amountNet,
        currencyCode: seed.currencyCode,
        position: adj.position ?? 0,
        metadata: adj.lineIndex !== undefined ? { lineIndex: adj.lineIndex } : null,
      })) ?? []

    const calculation = await calculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        currencyCode: seed.currencyCode,
      },
    })

    const order = em.create(SalesOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderNumber: seed.orderNumber,
      status: seed.status ?? 'confirmed',
      fulfillmentStatus: seed.fulfillmentStatus ?? null,
      paymentStatus: seed.paymentStatus ?? null,
      customerEntityId: null,
      customerContactId: null,
      currencyCode: seed.currencyCode,
      placedAt: seed.placedAt ?? null,
      expectedDeliveryAt: seed.expectedDeliveryAt ?? null,
      comments: seed.comments ?? null,
      internalNotes: seed.internalNotes ?? null,
      shippingMethodId: shippingMethod?.id ?? null,
      shippingMethodCode: shippingMethod?.code ?? seed.shippingMethodCode ?? null,
      paymentMethodId: paymentMethod?.id ?? null,
      paymentMethodCode: paymentMethod?.code ?? seed.paymentMethodCode ?? null,
      channelId: channel?.id ?? null,
      shippingMethodSnapshot: buildShippingMethodSnapshot(shippingMethod),
      paymentMethodSnapshot: buildPaymentMethodSnapshot(paymentMethod),
      metadata: seed.metadata ?? { seed: 'sales.examples' },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(order)

    const lineEntities: SalesOrderLine[] = []
    calculation.lines.forEach((lineResult, idx) => {
      const source = lineSnapshots[idx]
      const entity = em.create(SalesOrderLine, {
        id: source.id,
        order,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineNumber: idx + 1,
        kind: source.kind ?? 'product',
        name: source.name,
        description: source.description,
        comment: source.comment,
        quantity: toAmount(source.quantity),
        quantityUnit: source.quantityUnit ?? null,
        reservedQuantity: '0',
        fulfilledQuantity: '0',
        invoicedQuantity: '0',
        returnedQuantity: '0',
        currencyCode: source.currencyCode,
        unitPriceNet: toAmount(source.unitPriceNet ?? 0),
        unitPriceGross: toAmount(source.unitPriceGross ?? source.unitPriceNet ?? 0),
        discountAmount: toAmount(lineResult.discountAmount),
        discountPercent:
          source.discountPercent !== null && source.discountPercent !== undefined
            ? toAmount(source.discountPercent)
            : '0',
        taxRate: toAmount(source.taxRate ?? 0),
        taxAmount: toAmount(lineResult.taxAmount),
        totalNetAmount: toAmount(lineResult.netAmount),
        totalGrossAmount: toAmount(lineResult.grossAmount),
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(entity)
      lineEntities.push(entity)
    })

    calculation.adjustments.forEach((adj, idx) => {
      const lineIndex = adj.metadata && typeof adj.metadata === 'object' ? (adj.metadata as any).lineIndex : null
      const lineRef =
        typeof lineIndex === 'number' && lineIndex >= 0 && lineIndex < seed.lines.length
          ? lineEntities[lineIndex] ?? null
          : null
      const adjustment = em.create(SalesOrderAdjustment, {
        id: adj.id ?? randomUUID(),
        order,
        orderLine: lineRef,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        scope: adj.scope,
        kind: adj.kind,
        code: adj.code ?? adj.label ?? null,
        label: adj.label ?? adj.code ?? null,
        calculatorKey: adj.calculatorKey ?? null,
        promotionId: adj.promotionId ?? null,
        rate: adj.rate !== null && adj.rate !== undefined ? toAmount(adj.rate) : '0',
        amountNet: toAmount(adj.amountNet ?? 0),
        amountGross: toAmount(adj.amountGross ?? adj.amountNet ?? 0),
        currencyCode: adj.currencyCode ?? seed.currencyCode,
        metadata: adj.metadata ?? null,
        position: adj.position ?? idx,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(adjustment)
    })

    order.subtotalNetAmount = toAmount(calculation.totals.subtotalNetAmount)
    order.subtotalGrossAmount = toAmount(calculation.totals.subtotalGrossAmount)
    order.discountTotalAmount = toAmount(calculation.totals.discountTotalAmount)
    order.taxTotalAmount = toAmount(calculation.totals.taxTotalAmount)
    order.shippingNetAmount = toAmount(calculation.totals.shippingNetAmount ?? 0)
    order.shippingGrossAmount = toAmount(calculation.totals.shippingGrossAmount ?? 0)
    order.surchargeTotalAmount = toAmount(calculation.totals.surchargeTotalAmount ?? 0)
    order.grandTotalNetAmount = toAmount(calculation.totals.grandTotalNetAmount)
    order.grandTotalGrossAmount = toAmount(calculation.totals.grandTotalGrossAmount)
    order.paidTotalAmount = toAmount(calculation.totals.paidTotalAmount ?? 0)
    order.refundedTotalAmount = toAmount(calculation.totals.refundedTotalAmount ?? 0)
    order.outstandingAmount = toAmount(calculation.totals.outstandingAmount ?? calculation.totals.grandTotalGrossAmount)
    order.totalsSnapshot = toSnapshot(calculation.totals)
    order.lineItemCount = seed.lines.length

    if (seed.shipments?.length) {
      for (const shipmentSeed of seed.shipments) {
        const shipment = em.create(SalesShipment, {
          id: randomUUID(),
          order,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          shipmentNumber: shipmentSeed.shipmentNumber ?? null,
          shippingMethodId: shipmentSeed.methodCode
            ? shippingMethods.get(shipmentSeed.methodCode.toLowerCase())?.id ?? null
            : null,
          status: shipmentSeed.status ?? null,
          carrierName: null,
          trackingNumbers: shipmentSeed.trackingNumbers ?? null,
          shippedAt: shipmentSeed.shippedAt ?? null,
          deliveredAt: shipmentSeed.deliveredAt ?? null,
          weightValue: shipmentSeed.weightKg ? toAmount(shipmentSeed.weightKg) : null,
          weightUnit: shipmentSeed.weightKg ? 'kg' : null,
          declaredValueNet: shipmentSeed.declaredValue ? toAmount(shipmentSeed.declaredValue) : null,
          declaredValueGross: shipmentSeed.declaredValue ? toAmount(shipmentSeed.declaredValue) : null,
          currencyCode: shipmentSeed.currencyCode ?? seed.currencyCode,
          notesText: shipmentSeed.notes ?? null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(shipment)

        for (const item of shipmentSeed.items) {
          const line = lineEntities[item.lineIndex]
          if (!line) continue
          line.fulfilledQuantity = toAmount(
            Number(line.fulfilledQuantity ?? '0') + Math.max(item.quantity, 0)
          )
          const shipmentItem = em.create(SalesShipmentItem, {
            id: randomUUID(),
            shipment,
            orderLine: line,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            quantity: toAmount(item.quantity),
            metadata: null,
          })
          em.persist(shipmentItem)
        }
      }
    }

    let paymentTotal = 0
    if (seed.payments?.length) {
      for (const paymentSeed of seed.payments) {
        paymentTotal += paymentSeed.amount
        const method = paymentSeed.methodCode
          ? paymentMethods.get(paymentSeed.methodCode.toLowerCase()) ?? null
          : paymentMethod
        const payment = em.create(SalesPayment, {
          id: randomUUID(),
          order,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          paymentMethod: method ?? null,
          paymentReference: paymentSeed.reference ?? null,
          status: paymentSeed.status ?? null,
          amount: toAmount(paymentSeed.amount),
          currencyCode: paymentSeed.currencyCode,
          capturedAmount: toAmount(paymentSeed.capturedAt ? paymentSeed.amount : 0),
          refundedAmount: '0',
          receivedAt: paymentSeed.receivedAt ?? null,
          capturedAt: paymentSeed.capturedAt ?? null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(payment)
        const allocation = em.create(SalesPaymentAllocation, {
          id: randomUUID(),
          payment,
          order,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          amount: toAmount(paymentSeed.amount),
          currencyCode: paymentSeed.currencyCode,
          metadata: null,
        })
        em.persist(allocation)
      }
    }

    if (seed.addresses?.length) {
      attachDocumentAddresses(em, {
        documentId: orderId,
        documentKind: 'order',
        addresses: seed.addresses,
        order,
      })
      const billing = seed.addresses.find((a) => a.role === 'billing')
      const shipping = seed.addresses.find((a) => a.role === 'shipping')
      order.billingAddressSnapshot = billing ? buildAddressSnapshot(billing) : null
      order.shippingAddressSnapshot = shipping ? buildAddressSnapshot(shipping) : null
    }
    if (seed.notes?.length) {
      attachNotes(em, {
        contextId: orderId,
        contextType: 'order',
        notes: seed.notes,
        order,
      })
    }

    const grandTotal = Number(order.grandTotalGrossAmount ?? '0')
    order.paidTotalAmount = toAmount(paymentTotal)
    order.outstandingAmount = toAmount(Math.max(grandTotal - paymentTotal, 0))
    order.paymentStatus = seed.paymentStatus ?? mapPaymentStatus(grandTotal - paymentTotal)
    const isFullyFulfilled = lineEntities.every((line, idx) => {
      const expected = Number(seed.lines[idx]?.quantity ?? 0)
      const fulfilled = Number(line.fulfilledQuantity ?? '0')
      return fulfilled >= expected
    })
    order.fulfillmentStatus = seed.fulfillmentStatus ?? (isFullyFulfilled ? 'fulfilled' : 'in_fulfillment')
  }

  await em.flush()
  return true
}
