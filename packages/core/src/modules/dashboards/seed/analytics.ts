import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  SalesOrder,
  SalesOrderLine,
} from '@open-mercato/core/modules/sales/data/entities'
import {
  CustomerEntity,
  CustomerCompanyProfile,
  CustomerDeal,
} from '@open-mercato/core/modules/customers/data/entities'
import {
  CatalogProduct,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'

export type AnalyticsSeedScope = {
  tenantId: string
  organizationId: string
}

export type AnalyticsSeedOptions = {
  months?: number
  ordersPerMonth?: number
  customersCount?: number
  productsCount?: number
  dealsCount?: number
}

const ORDER_STATUSES = ['draft', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'] as const
const FULFILLMENT_STATUSES = ['pending', 'in_fulfillment', 'partially_fulfilled', 'fulfilled'] as const
const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const
const DEAL_PIPELINE_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'CA', 'AU', 'NL', 'ES', 'IT', 'PL'] as const
const REGIONS_BY_COUNTRY: Record<string, string[]> = {
  US: ['California', 'New York', 'Texas', 'Florida', 'Illinois', 'Washington', 'Massachusetts'],
  GB: ['England', 'Scotland', 'Wales'],
  DE: ['Bavaria', 'Berlin', 'Hamburg', 'Hessen'],
  FR: ['Île-de-France', 'Provence', 'Rhône-Alpes'],
  CA: ['Ontario', 'Quebec', 'British Columbia'],
  AU: ['New South Wales', 'Victoria', 'Queensland'],
  NL: ['North Holland', 'South Holland'],
  ES: ['Madrid', 'Catalonia', 'Andalusia'],
  IT: ['Lombardy', 'Lazio', 'Veneto'],
  PL: ['Mazovia', 'Lesser Poland', 'Silesia'],
}

const COMPANY_NAMES = [
  'Acme Corp', 'Global Industries', 'Tech Solutions', 'Prime Services',
  'Northern Analytics', 'Blue Ocean Trading', 'Summit Enterprises', 'Horizon Dynamics',
  'Vertex Systems', 'Atlas Logistics', 'Pinnacle Group', 'Quantum Labs',
  'Stellar Innovations', 'Pacific Partners', 'Apex Manufacturing', 'Nexus Technologies',
  'Eclipse Ventures', 'Titan Holdings', 'Vanguard Solutions', 'Momentum Corp',
  'Crystal Clear Media', 'Silver Line Transport', 'Golden Gate Imports', 'Red Rock Mining',
  'Green Valley Foods', 'Blue Sky Aviation', 'White Mountain Retail', 'Black Diamond Sports',
]

const PRODUCT_NAMES = [
  'Premium Widget', 'Standard Component', 'Professional Kit', 'Enterprise Module',
  'Basic Starter Pack', 'Advanced System', 'Deluxe Bundle', 'Essential Tools',
  'Pro Series Device', 'Ultra Performance Unit', 'Classic Edition', 'Limited Series',
  'Industrial Grade Part', 'Consumer Package', 'Business Solution', 'Home Edition',
]

const DEAL_TITLES = [
  'Enterprise License Deal', 'Annual Subscription', 'Pilot Program', 'Strategic Partnership',
  'Volume Purchase Agreement', 'Service Contract', 'Implementation Project', 'Expansion Deal',
  'Renewal Opportunity', 'Upsell Initiative', 'Cross-sell Package', 'Custom Solution',
]

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, decimals = 2): number {
  const value = Math.random() * (max - min) + min
  return Number(value.toFixed(decimals))
}

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomElements<T>(arr: readonly T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, arr.length))
}

function toAmount(value: number): string {
  return value.toFixed(2)
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

function randomDateInRange(startDaysAgo: number, endDaysAgo: number): Date {
  const daysOffset = randomInt(endDaysAgo, startDaysAgo)
  return daysAgo(daysOffset)
}

function generateOrderNumber(index: number): string {
  return `SO-ANALYTICS-${String(index).padStart(5, '0')}`
}

export async function seedAnalyticsData(
  em: EntityManager,
  scope: AnalyticsSeedScope,
  options: AnalyticsSeedOptions = {}
): Promise<{ orders: number; customers: number; products: number; deals: number }> {
  const {
    months = 6,
    ordersPerMonth = 50,
    customersCount = 25,
    productsCount = 15,
    dealsCount = 20,
  } = options

  const existingOrders = await em.count(SalesOrder, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    orderNumber: { $like: 'SO-ANALYTICS-%' },
  })

  if (existingOrders > 0) {
    return { orders: 0, customers: 0, products: 0, deals: 0 }
  }

  const customers: CustomerEntity[] = []
  const products: CatalogProduct[] = []
  const variants: CatalogProductVariant[] = []

  for (let i = 0; i < customersCount; i++) {
    const companyName = COMPANY_NAMES[i % COMPANY_NAMES.length]
    const customerCreatedAt = randomDateInRange(months * 30 + 60, 0)

    const customer = em.create(CustomerEntity, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      kind: 'company',
      displayName: `${companyName} #${i + 1}`,
      primaryEmail: `contact${i + 1}@${companyName.toLowerCase().replace(/\s+/g, '')}.example.com`,
      status: 'active',
      lifecycleStage: randomElement(['lead', 'customer', 'opportunity']),
      isActive: true,
      createdAt: customerCreatedAt,
      updatedAt: customerCreatedAt,
    })
    em.persist(customer)
    customers.push(customer)

    const companyProfile = em.create(CustomerCompanyProfile, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity: customer,
      legalName: `${companyName} Inc.`,
      brandName: companyName,
      industry: randomElement(['Technology', 'Manufacturing', 'Retail', 'Services', 'Healthcare']),
      sizeBucket: randomElement(['small', 'medium', 'large', 'enterprise']),
      annualRevenue: toAmount(randomFloat(100000, 50000000)),
      createdAt: customerCreatedAt,
      updatedAt: customerCreatedAt,
    })
    em.persist(companyProfile)
  }

  for (let i = 0; i < productsCount; i++) {
    const productName = PRODUCT_NAMES[i % PRODUCT_NAMES.length]
    const productCreatedAt = daysAgo(months * 30 + randomInt(0, 30))

    const product = em.create(CatalogProduct, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: `${productName} ${i + 1}`,
      handle: `analytics-product-${i + 1}`,
      sku: `SKU-ANALYTICS-${String(i + 1).padStart(3, '0')}`,
      productType: 'simple',
      isConfigurable: false,
      isActive: true,
      omnibusExempt: false,
      createdAt: productCreatedAt,
      updatedAt: productCreatedAt,
    })
    em.persist(product)
    products.push(product)

    const variant = em.create(CatalogProductVariant, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      product,
      name: 'Default',
      sku: `${product.sku}-DEFAULT`,
      isDefault: true,
      isActive: true,
      createdAt: productCreatedAt,
      updatedAt: productCreatedAt,
    })
    em.persist(variant)
    variants.push(variant)
  }

  let orderIndex = 1
  const totalDays = months * 30
  const orders: SalesOrder[] = []

  for (let dayOffset = totalDays; dayOffset >= 0; dayOffset--) {
    const ordersToday = Math.round(ordersPerMonth / 30 * randomFloat(0.5, 1.5))

    for (let j = 0; j < ordersToday; j++) {
      const orderDate = daysAgo(dayOffset)
      const customer = randomElement(customers)
      const country = randomElement(COUNTRIES)
      const region = randomElement(REGIONS_BY_COUNTRY[country] || [''])

      const lineCount = randomInt(1, 5)
      const selectedProducts = randomElements(products, lineCount)

      let subtotalNet = 0
      let subtotalGross = 0
      let taxTotal = 0

      const orderLines: Array<{
        product: CatalogProduct
        variant: CatalogProductVariant
        quantity: number
        unitPriceNet: number
        unitPriceGross: number
        taxRate: number
        lineNetAmount: number
        lineGrossAmount: number
        lineTaxAmount: number
      }> = []

      for (let k = 0; k < selectedProducts.length; k++) {
        const product = selectedProducts[k]
        const variant = variants.find((v) => v.product.id === product.id) || variants[0]
        const quantity = randomInt(1, 10)
        const unitPriceNet = randomFloat(10, 500)
        const taxRate = randomElement([0, 5, 10, 20, 23])
        const unitPriceGross = unitPriceNet * (1 + taxRate / 100)
        const lineNetAmount = unitPriceNet * quantity
        const lineGrossAmount = unitPriceGross * quantity
        const lineTaxAmount = lineGrossAmount - lineNetAmount

        subtotalNet += lineNetAmount
        subtotalGross += lineGrossAmount
        taxTotal += lineTaxAmount

        orderLines.push({
          product,
          variant,
          quantity,
          unitPriceNet,
          unitPriceGross,
          taxRate,
          lineNetAmount,
          lineGrossAmount,
          lineTaxAmount,
        })
      }

      const order = em.create(SalesOrder, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        orderNumber: generateOrderNumber(orderIndex++),
        status: randomElement(ORDER_STATUSES),
        fulfillmentStatus: randomElement(FULFILLMENT_STATUSES),
        paymentStatus: randomElement(PAYMENT_STATUSES),
        customerEntityId: customer.id,
        customerSnapshot: {
          customer: {
            id: customer.id,
            kind: customer.kind,
            displayName: customer.displayName,
          },
        },
        currencyCode: 'USD',
        placedAt: orderDate,
        shippingAddressSnapshot: {
          country,
          region,
          city: `City ${randomInt(1, 100)}`,
          postalCode: String(randomInt(10000, 99999)),
        },
        billingAddressSnapshot: {
          country,
          region,
          city: `City ${randomInt(1, 100)}`,
          postalCode: String(randomInt(10000, 99999)),
        },
        subtotalNetAmount: toAmount(subtotalNet),
        subtotalGrossAmount: toAmount(subtotalGross),
        discountTotalAmount: '0.00',
        taxTotalAmount: toAmount(taxTotal),
        shippingNetAmount: '0.00',
        shippingGrossAmount: '0.00',
        surchargeTotalAmount: '0.00',
        grandTotalNetAmount: toAmount(subtotalNet),
        grandTotalGrossAmount: toAmount(subtotalGross),
        paidTotalAmount: '0.00',
        refundedTotalAmount: '0.00',
        outstandingAmount: toAmount(subtotalGross),
        lineItemCount: orderLines.length,
        metadata: { seed: 'dashboards.analytics' },
        createdAt: orderDate,
        updatedAt: orderDate,
      })
      em.persist(order)
      orders.push(order)

      for (let k = 0; k < orderLines.length; k++) {
        const lineData = orderLines[k]
        const line = em.create(SalesOrderLine, {
          id: randomUUID(),
          order,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          lineNumber: k + 1,
          kind: 'product',
          name: lineData.product.title,
          quantity: toAmount(lineData.quantity),
          currencyCode: 'USD',
          unitPriceNet: toAmount(lineData.unitPriceNet),
          unitPriceGross: toAmount(lineData.unitPriceGross),
          discountAmount: '0.00',
          discountPercent: '0.00',
          taxRate: toAmount(lineData.taxRate),
          taxAmount: toAmount(lineData.lineTaxAmount),
          totalNetAmount: toAmount(lineData.lineNetAmount),
          totalGrossAmount: toAmount(lineData.lineGrossAmount),
          reservedQuantity: '0',
          fulfilledQuantity: '0',
          invoicedQuantity: '0',
          returnedQuantity: '0',
          productId: lineData.product.id,
          productVariantId: lineData.variant?.id ?? null,
          catalogSnapshot: {
            product: {
              id: lineData.product.id,
              title: lineData.product.title,
              sku: lineData.product.sku,
            },
            variant: lineData.variant
              ? {
                  id: lineData.variant.id,
                  name: lineData.variant.name,
                  sku: lineData.variant.sku,
                }
              : null,
          },
          createdAt: orderDate,
          updatedAt: orderDate,
        })
        em.persist(line)
      }
    }
  }

  for (let i = 0; i < dealsCount; i++) {
    const customer = randomElement(customers)
    const dealCreatedAt = randomDateInRange(months * 30, 0)
    const pipelineStage = randomElement(DEAL_PIPELINE_STAGES)

    const probabilityByStage: Record<string, number> = {
      lead: 10,
      qualified: 25,
      proposal: 50,
      negotiation: 75,
      closed_won: 100,
      closed_lost: 0,
    }

    const deal = em.create(CustomerDeal, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: `${randomElement(DEAL_TITLES)} - ${customer.displayName}`,
      status: pipelineStage === 'closed_won' || pipelineStage === 'closed_lost' ? 'closed' : 'open',
      pipelineStage,
      valueAmount: toAmount(randomFloat(5000, 500000)),
      valueCurrency: 'USD',
      probability: probabilityByStage[pipelineStage],
      expectedCloseAt: daysAgo(randomInt(-60, 90)),
      source: randomElement(['inbound', 'outbound', 'referral', 'partner']),
      createdAt: dealCreatedAt,
      updatedAt: dealCreatedAt,
    })
    em.persist(deal)
  }

  await em.flush()

  return {
    orders: orders.length,
    customers: customers.length,
    products: products.length,
    deals: dealsCount,
  }
}
