import type { EntityManager } from '@mikro-orm/core'
import {
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import {
  CustomerActivity,
  CustomerAddress,
  CustomerComment,
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerEntity,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { SalesChannel, SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'

type Scope = {
  organizationId: string
  tenantId: string
}

type ProductSeed = {
  key: string
  title: string
  sku: string
  basePrice: number
  category: string
  stockQuantity: number
  subtitle?: string
  description?: string
}

type ProductRecord = {
  entity: CatalogProduct
  seed: ProductSeed
}

type OrderLinePlan = {
  productKey: string
  quantity: number
  totalGrossAmount: number
}

export interface SeedResult {
  companyId: string
  customerId: string
  productIds: string[]
  dealIds: string[]
}

const DEMO_SOURCE = 'voice_channels.demo'
const DEMO_CHANNEL_CODE = 'voice_channels_demo'
const DEMO_PRICE_KIND_CODE = 'voice_channels_regular_pln'
const DEMO_ORDER_PREFIX = 'VC-DEMO'
const DEAL_GDANSK = 'Dostawa rur do projektu Gdańsk'
const DEAL_HALL = 'Armatura dla nowej hali'
const DEAL_YEARLY = 'Zamówienie roczne 2026'
const HISTORICAL_ORDER_TOTALS = [
  4200, 5100, 5600, 6000, 6450, 6800, 7000, 7200, 7350, 7600, 5800, 6250, 6900, 7400, 7800, 8200,
  8600, 9100, 9700, 9450,
]

export async function seedDemoData(
  inputEm: EntityManager,
  organizationId: string,
  tenantId: string
): Promise<SeedResult> {
  const em = inputEm.fork()
  const scope = { organizationId, tenantId }

  const salesChannel = await ensureSalesChannel(em, scope)
  const regularPriceKind = await ensureRegularPriceKind(em, scope)
  const company = await ensureCompany(em, scope)
  const customer = await ensureCustomer(em, scope, company)

  await ensureCompanyAddress(em, scope, company)
  await ensureCustomerActivities(em, scope, customer)
  await ensureCustomerComment(em, scope, customer)

  const productRecords = await ensureProducts(em, scope)

  await ensureBasePrices(em, scope, regularPriceKind, productRecords)
  await ensureCustomerSpecificPrices(em, scope, regularPriceKind, customer.id, productRecords)

  const deals = await ensureDeals(em, scope, company, customer)
  await ensureHistoricalOrders(em, scope, salesChannel, customer, company, productRecords)

  return {
    companyId: company.id,
    customerId: customer.id,
    productIds: productRecords.map((record) => record.entity.id),
    dealIds: deals.map((deal) => deal.id),
  }
}

async function ensureSalesChannel(em: EntityManager, scope: Scope): Promise<SalesChannel> {
  const existing = await em.findOne(SalesChannel, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    code: DEMO_CHANNEL_CODE,
  })

  if (existing) {
    return existing
  }

  const channel = em.create(SalesChannel, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name: 'Voice Demo Channel',
    code: DEMO_CHANNEL_CODE,
    description: 'Sales channel for the Call Copilot demo dataset.',
    status: 'active',
    isActive: true,
    metadata: { seedSource: DEMO_SOURCE },
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await em.persistAndFlush(channel)
  return channel
}

async function ensureRegularPriceKind(em: EntityManager, scope: Scope): Promise<CatalogPriceKind> {
  const existing = await em.findOne(CatalogPriceKind, {
    tenantId: scope.tenantId,
    code: DEMO_PRICE_KIND_CODE,
  })

  if (existing) {
    if (existing.organizationId !== scope.organizationId) {
      existing.organizationId = scope.organizationId
      existing.currencyCode = 'PLN'
      existing.isPromotion = false
      existing.isActive = true
      await em.persistAndFlush(existing)
    }
    return existing
  }

  const priceKind = em.create(CatalogPriceKind, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    code: DEMO_PRICE_KIND_CODE,
    title: 'Voice Demo Regular PLN',
    displayMode: 'including-tax',
    currencyCode: 'PLN',
    isPromotion: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await em.persistAndFlush(priceKind)
  return priceKind
}

async function ensureCompany(em: EntityManager, scope: Scope): Promise<CustomerEntity> {
  let entity = await em.findOne(
    CustomerEntity,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      kind: 'company',
      primaryEmail: 'kontakt@acme-mfg.pl',
    },
    { populate: ['companyProfile'] }
  )

  if (!entity) {
    entity = em.create(CustomerEntity, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      kind: 'company',
      displayName: 'Acme Manufacturing Sp. z o.o.',
      description: 'Kluczowy klient demo dla scenariusza Call Copilot.',
      primaryEmail: 'kontakt@acme-mfg.pl',
      primaryPhone: '+48 512 345 678',
      lifecycleStage: 'customer',
      status: 'active',
      source: DEMO_SOURCE,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entity)
  }

  let profile = entity.companyProfile
  if (!profile) {
    profile = await em.findOne(CustomerCompanyProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity,
    })
  }

  if (!profile) {
    profile = em.create(CustomerCompanyProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity,
      legalName: 'Acme Manufacturing Sp. z o.o.',
      brandName: 'Acme Manufacturing',
      domain: 'acme-mfg.pl',
      websiteUrl: 'https://acme-mfg.example.com',
      industry: 'Manufacturing',
      sizeBucket: 'mid_market',
      annualRevenue: formatMoney(18500000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(profile)
  }

  await em.persistAndFlush([entity, profile])
  return entity
}

async function ensureCustomer(
  em: EntityManager,
  scope: Scope,
  company: CustomerEntity
): Promise<CustomerEntity> {
  let entity = await em.findOne(
    CustomerEntity,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      kind: 'person',
      primaryEmail: 'j.kowalski@acme-mfg.pl',
    },
    { populate: ['personProfile'] }
  )

  if (!entity) {
    entity = em.create(CustomerEntity, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      kind: 'person',
      displayName: 'Jan Kowalski',
      description: 'Kierownik zakupów odpowiedzialny za projekty budowlane Acme.',
      primaryEmail: 'j.kowalski@acme-mfg.pl',
      primaryPhone: '+48 512 345 678',
      lifecycleStage: 'customer',
      status: 'active',
      source: DEMO_SOURCE,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entity)
  }

  let profile = entity.personProfile
  if (!profile) {
    profile = await em.findOne(CustomerPersonProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity,
    })
  }

  if (!profile) {
    profile = em.create(CustomerPersonProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity,
      company,
      firstName: 'Jan',
      lastName: 'Kowalski',
      preferredName: 'Jan',
      jobTitle: 'Kierownik Zakupów',
      department: 'Zakupy',
      seniority: 'manager',
      timezone: 'Europe/Warsaw',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(profile)
  } else if (!profile.company || profile.company.id !== company.id) {
    profile.company = company
    profile.updatedAt = new Date()
    em.persist(profile)
  }

  await em.persistAndFlush([entity, profile])
  return entity
}

async function ensureCompanyAddress(em: EntityManager, scope: Scope, company: CustomerEntity): Promise<void> {
  const existing = await em.findOne(CustomerAddress, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    entity: company,
    addressLine1: 'ul. Stalowa 15',
  })

  if (existing) {
    return
  }

  const address = em.create(CustomerAddress, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    entity: company,
    name: 'Siedziba główna',
    purpose: 'office',
    companyName: 'Acme Manufacturing Sp. z o.o.',
    addressLine1: 'ul. Stalowa 15',
    city: 'Gdańsk',
    region: 'Pomorskie',
    postalCode: '80-001',
    country: 'PL',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await em.persistAndFlush(address)
}

async function ensureCustomerActivities(em: EntityManager, scope: Scope, customer: CustomerEntity): Promise<void> {
  const activitySeeds = [
    {
      activityType: 'call',
      subject: '[voice_channels.demo] Ustalenie harmonogramu dostaw Q2',
      body: 'Jan potwierdził większe zapotrzebowanie na rury DN50 do projektu w Gdańsku.',
      occurredAt: daysAgo(41),
    },
    {
      activityType: 'call',
      subject: '[voice_channels.demo] Omówienie cen kwartalnych',
      body: 'Klient sygnalizował presję cenową i pytał o możliwe rabaty wolumenowe.',
      occurredAt: daysAgo(28),
    },
    {
      activityType: 'call',
      subject: '[voice_channels.demo] Status otwartych zamówień',
      body: 'Najważniejsze są terminowość dostaw i pełna certyfikacja PN-EN.',
      occurredAt: daysAgo(15),
    },
    {
      activityType: 'email',
      subject: '[voice_channels.demo] Prośba o ofertę na rury i zawory',
      body: 'Jan poprosił o szybką ofertę na rury stalowe i zawory kulowe na dwa tygodnie przed startem budowy.',
      occurredAt: daysAgo(9),
    },
    {
      activityType: 'note',
      subject: '[voice_channels.demo] Preferencje współpracy',
      body: 'Klient preferuje konkretne widełki cenowe, dostawy co 2 tygodnie i szybkie potwierdzenia stanów magazynowych.',
      occurredAt: daysAgo(4),
    },
  ]

  for (const seed of activitySeeds) {
    const existing = await em.findOne(CustomerActivity, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity: customer,
      subject: seed.subject,
    })

    if (existing) {
      continue
    }

    const activity = em.create(CustomerActivity, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity: customer,
      deal: null,
      activityType: seed.activityType,
      subject: seed.subject,
      body: seed.body,
      occurredAt: seed.occurredAt,
      authorUserId: null,
      appearanceIcon: seed.activityType === 'email' ? 'mail' : 'phone',
      appearanceColor: seed.activityType === 'note' ? 'amber' : 'blue',
      createdAt: seed.occurredAt,
      updatedAt: seed.occurredAt,
    })

    em.persist(activity)
  }

  await em.flush()
}

async function ensureCustomerComment(em: EntityManager, scope: Scope, customer: CustomerEntity): Promise<void> {
  const body =
    'Klient zainteresowany długoterminową umową. Preferuje dostawy co 2 tygodnie.'

  const existing = await em.findOne(CustomerComment, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    entity: customer,
    body,
  })

  if (existing) {
    return
  }

  const comment = em.create(CustomerComment, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    entity: customer,
    deal: null,
    body,
    authorUserId: null,
    appearanceIcon: 'note',
    appearanceColor: 'amber',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
  })

  await em.persistAndFlush(comment)
}

async function ensureProducts(em: EntityManager, scope: Scope): Promise<ProductRecord[]> {
  const seeds = buildProductSeeds()
  const records: ProductRecord[] = []

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index]
    let product = await em.findOne(CatalogProduct, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sku: seed.sku,
    })

    if (!product) {
      product = em.create(CatalogProduct, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        title: seed.title,
        subtitle: seed.subtitle ?? seed.category,
        description:
          seed.description ??
          `${seed.title} z kategorii ${seed.category} przygotowany dla scenariusza hackathonowego Call Copilot.`,
        sku: seed.sku,
        handle: slugify(seed.sku),
        primaryCurrencyCode: 'PLN',
        defaultUnit: 'szt',
        defaultSalesUnit: 'szt',
        defaultSalesUnitQuantity: '1',
        isActive: true,
        metadata: {
          seedSource: DEMO_SOURCE,
          seedKey: seed.key,
          categoryName: seed.category,
          stockQuantity: seed.stockQuantity,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(product)
    } else {
      product.title = seed.title
      product.subtitle = seed.subtitle ?? seed.category
      product.description =
        seed.description ??
        `${seed.title} z kategorii ${seed.category} przygotowany dla scenariusza hackathonowego Call Copilot.`
      product.primaryCurrencyCode = 'PLN'
      product.defaultUnit = 'szt'
      product.defaultSalesUnit = 'szt'
      product.defaultSalesUnitQuantity = '1'
      product.isActive = true
      product.metadata = {
        ...(product.metadata ?? {}),
        seedSource: DEMO_SOURCE,
        seedKey: seed.key,
        categoryName: seed.category,
        stockQuantity: seed.stockQuantity,
      }
      product.updatedAt = new Date()
      em.persist(product)
    }

    records.push({ entity: product, seed })
  }

  await em.flush()
  return records
}

async function ensureBasePrices(
  em: EntityManager,
  scope: Scope,
  priceKind: CatalogPriceKind,
  products: ProductRecord[]
): Promise<void> {
  for (const record of products) {
    const existing = await em.findOne(CatalogProductPrice, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      product: record.entity,
      priceKind,
      customerId: null,
    })

    if (existing) {
      existing.currencyCode = 'PLN'
      existing.kind = 'regular'
      existing.unitPriceNet = formatMoney(record.seed.basePrice)
      existing.unitPriceGross = formatMoney(record.seed.basePrice)
      existing.minQuantity = 1
      existing.startsAt = null
      existing.endsAt = null
      existing.updatedAt = new Date()
      em.persist(existing)
      continue
    }

    em.persist(
      em.create(CatalogProductPrice, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        product: record.entity,
        priceKind,
        currencyCode: 'PLN',
        kind: 'regular',
        minQuantity: 1,
        unitPriceNet: formatMoney(record.seed.basePrice),
        unitPriceGross: formatMoney(record.seed.basePrice),
        customerId: null,
        startsAt: null,
        endsAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    )
  }

  await em.flush()
}

async function ensureCustomerSpecificPrices(
  em: EntityManager,
  scope: Scope,
  priceKind: CatalogPriceKind,
  customerId: string,
  products: ProductRecord[]
): Promise<void> {
  const overrides = new Map<string, number>([
    ['RS-DN50-PN16', 22.4],
    ['ZK-DN25', 35.6],
  ])

  for (const record of products) {
    const override = overrides.get(record.seed.sku)
    if (override === undefined) {
      continue
    }

    const existing = await em.findOne(CatalogProductPrice, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      product: record.entity,
      priceKind,
      customerId,
    })

    if (existing) {
      existing.currencyCode = 'PLN'
      existing.kind = 'customer'
      existing.unitPriceNet = formatMoney(override)
      existing.unitPriceGross = formatMoney(override)
      existing.minQuantity = 1
      existing.startsAt = null
      existing.endsAt = null
      existing.updatedAt = new Date()
      em.persist(existing)
      continue
    }

    em.persist(
      em.create(CatalogProductPrice, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        product: record.entity,
        priceKind,
        currencyCode: 'PLN',
        kind: 'customer',
        minQuantity: 1,
        customerId,
        unitPriceNet: formatMoney(override),
        unitPriceGross: formatMoney(override),
        startsAt: null,
        endsAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    )
  }

  await em.flush()
}

async function ensureDeals(
  em: EntityManager,
  scope: Scope,
  company: CustomerEntity,
  customer: CustomerEntity
): Promise<CustomerDeal[]> {
  const dealSeeds = [
    {
      title: DEAL_GDANSK,
      stage: 'Negotiation',
      valueAmount: 45000,
      probability: 70,
      ageDays: 8,
      description: 'Oferta na rury stalowe DN50 i zawory do budowy w Gdańsku.',
    },
    {
      title: DEAL_HALL,
      stage: 'Proposal',
      valueAmount: 28000,
      probability: 55,
      ageDays: 3,
      description: 'Dostawa armatury dla nowej hali produkcyjnej Acme.',
    },
    {
      title: DEAL_YEARLY,
      stage: 'Discovery',
      valueAmount: 180000,
      probability: 35,
      ageDays: 22,
      description: 'Roczny kontrakt ramowy na dostawy rur, zaworów i kształtek.',
    },
  ]

  const deals: CustomerDeal[] = []

  for (const seed of dealSeeds) {
    let deal = await em.findOne(CustomerDeal, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: seed.title,
    })

    const timestamp = daysAgo(seed.ageDays)

    if (!deal) {
      deal = em.create(CustomerDeal, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        title: seed.title,
        description: seed.description,
        status: 'open',
        pipelineStage: seed.stage,
        valueAmount: formatMoney(seed.valueAmount),
        valueCurrency: 'PLN',
        probability: seed.probability,
        expectedCloseAt: daysFromNow(Math.max(7, 35 - seed.ageDays)),
        ownerUserId: null,
        source: DEMO_SOURCE,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      em.persist(deal)
      await em.flush()
    } else {
      deal.description = seed.description
      deal.status = 'open'
      deal.pipelineStage = seed.stage
      deal.valueAmount = formatMoney(seed.valueAmount)
      deal.valueCurrency = 'PLN'
      deal.probability = seed.probability
      deal.updatedAt = timestamp
      em.persist(deal)
      await em.flush()
    }

    const companyLink = await em.findOne(CustomerDealCompanyLink, {
      deal,
      company,
    })
    if (!companyLink) {
      em.persist(
        em.create(CustomerDealCompanyLink, {
          deal,
          company,
          createdAt: timestamp,
        })
      )
    }

    const personLink = await em.findOne(CustomerDealPersonLink, {
      deal,
      person: customer,
    })
    if (!personLink) {
      em.persist(
        em.create(CustomerDealPersonLink, {
          deal,
          person: customer,
          participantRole: 'buyer',
          createdAt: timestamp,
        })
      )
    }

    deals.push(deal)
  }

  await em.flush()
  return deals
}

async function ensureHistoricalOrders(
  em: EntityManager,
  scope: Scope,
  channel: SalesChannel,
  customer: CustomerEntity,
  company: CustomerEntity,
  products: ProductRecord[]
): Promise<void> {
  const productMap = new Map(products.map((record) => [record.seed.key, record]))
  const preferredProductKeys = [
    'pipe-dn50-pn16',
    'valve-ball-dn25',
    'pipe-dn80-pn16',
    'pipe-dn40-pn16',
    'fitting-tee-dn50',
    'fitting-reducer-50-25',
    'fitting-elbow-90-dn50',
    'hardware-gasket-dn50',
  ]

  for (let index = 0; index < HISTORICAL_ORDER_TOTALS.length; index += 1) {
    const orderNumber = `${DEMO_ORDER_PREFIX}-${String(index + 1).padStart(3, '0')}`
    const existing = await em.findOne(SalesOrder, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderNumber,
    })

    if (existing) {
      continue
    }

    const total = HISTORICAL_ORDER_TOTALS[index]
    const placedAt = monthsAgo(12 - Math.min(index, 11), index % 4)
    const linePlans = buildOrderLinePlans(total, preferredProductKeys, index, productMap)

    const order = em.create(SalesOrder, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderNumber,
      externalReference: `ACME-${String(index + 1).padStart(4, '0')}`,
      customerReference: `BUD-GDA-${String(index + 1).padStart(2, '0')}`,
      customerEntityId: customer.id,
      customerContactId: customer.id,
      customerSnapshot: {
        personName: 'Jan Kowalski',
        companyName: company.displayName,
        email: 'j.kowalski@acme-mfg.pl',
      },
      currencyCode: 'PLN',
      status: 'paid',
      fulfillmentStatus: 'delivered',
      paymentStatus: 'paid',
      placedAt,
      comments: 'Historyczne zamówienie klienta demo dla Call Copilot.',
      internalNotes: `seed:${DEMO_SOURCE}`,
      subtotalNetAmount: formatMoney(total),
      subtotalGrossAmount: formatMoney(total),
      discountTotalAmount: '0.0000',
      taxTotalAmount: '0.0000',
      shippingNetAmount: '0.0000',
      shippingGrossAmount: '0.0000',
      surchargeTotalAmount: '0.0000',
      grandTotalNetAmount: formatMoney(total),
      grandTotalGrossAmount: formatMoney(total),
      paidTotalAmount: formatMoney(total),
      refundedTotalAmount: '0.0000',
      outstandingAmount: '0.0000',
      lineItemCount: linePlans.length,
      metadata: { seedSource: DEMO_SOURCE, historical: true },
      channelId: channel.id,
      channel,
      createdAt: placedAt,
      updatedAt: placedAt,
    })

    em.persist(order)

    for (let lineIndex = 0; lineIndex < linePlans.length; lineIndex += 1) {
      const linePlan = linePlans[lineIndex]
      const product = productMap.get(linePlan.productKey)
      if (!product) {
        throw new Error(`Missing seeded product for key "${linePlan.productKey}"`)
      }

      const unitPrice = linePlan.totalGrossAmount / linePlan.quantity
      const categoryName = product.seed.category

      em.persist(
        em.create(SalesOrderLine, {
          order,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          lineNumber: lineIndex + 1,
          kind: 'product',
          status: 'completed',
          productId: product.entity.id,
          catalogSnapshot: {
            productId: product.entity.id,
            title: product.seed.title,
            sku: product.seed.sku,
            categoryName,
          },
          name: product.seed.title,
          description: `${categoryName} | SKU ${product.seed.sku}`,
          quantity: formatQuantity(linePlan.quantity),
          quantityUnit: 'szt',
          normalizedQuantity: formatQuantity(linePlan.quantity),
          normalizedUnit: 'szt',
          currencyCode: 'PLN',
          unitPriceNet: formatMoney(unitPrice),
          unitPriceGross: formatMoney(unitPrice),
          discountAmount: '0.0000',
          discountPercent: '0.0000',
          taxRate: '0.0000',
          taxAmount: '0.0000',
          totalNetAmount: formatMoney(linePlan.totalGrossAmount),
          totalGrossAmount: formatMoney(linePlan.totalGrossAmount),
          metadata: {
            seedSource: DEMO_SOURCE,
            categoryName,
          },
          createdAt: placedAt,
          updatedAt: placedAt,
        })
      )
    }
  }

  await em.flush()
}

function buildOrderLinePlans(
  total: number,
  preferredProductKeys: string[],
  index: number,
  productMap: Map<string, ProductRecord>
): OrderLinePlan[] {
  const keyA = preferredProductKeys[index % preferredProductKeys.length]
  const keyB = preferredProductKeys[(index + 2) % preferredProductKeys.length]
  const keyC = preferredProductKeys[(index + 5) % preferredProductKeys.length]

  const amountA = roundMoney(total * 0.5)
  const amountB = roundMoney(total * 0.3)
  const amountC = roundMoney(total - amountA - amountB)

  const productA = productMap.get(keyA)
  const productB = productMap.get(keyB)
  const productC = productMap.get(keyC)

  if (!productA || !productB || !productC) {
    throw new Error('Order line product selection failed for demo seed')
  }

  return [
    {
      productKey: keyA,
      quantity: Math.max(1, Math.round(amountA / productA.seed.basePrice)),
      totalGrossAmount: amountA,
    },
    {
      productKey: keyB,
      quantity: Math.max(1, Math.round(amountB / productB.seed.basePrice)),
      totalGrossAmount: amountB,
    },
    {
      productKey: keyC,
      quantity: Math.max(1, Math.round(amountC / productC.seed.basePrice)),
      totalGrossAmount: amountC,
    },
  ]
}

function buildProductSeeds(): ProductSeed[] {
  const pipesPn16 = [
    { dn: 25, price: 15.8 },
    { dn: 32, price: 18.5 },
    { dn: 40, price: 21.2 },
    { dn: 50, price: 24.9 },
    { dn: 65, price: 32.5 },
    { dn: 80, price: 38.2 },
    { dn: 100, price: 48.6 },
    { dn: 125, price: 61.2 },
    { dn: 150, price: 74.4 },
  ]
  const pipesPn25 = [
    { dn: 40, price: 25.7 },
    { dn: 50, price: 29.4 },
    { dn: 65, price: 37.2 },
    { dn: 80, price: 45.8 },
    { dn: 100, price: 58.9 },
  ]
  const stainlessPipes = [
    { dn: 25, price: 34.9 },
    { dn: 40, price: 44.8 },
    { dn: 50, price: 52.3 },
    { dn: 80, price: 71.6 },
  ]
  const valves = [
    ['valve-ball-dn15', 'Zawór kulowy DN15', 'ZK-DN15', 28.5],
    ['valve-ball-dn20', 'Zawór kulowy DN20', 'ZK-DN20', 32],
    ['valve-ball-dn25', 'Zawór kulowy DN25', 'ZK-DN25', 38.9],
    ['valve-ball-dn32', 'Zawór kulowy DN32', 'ZK-DN32', 45.6],
    ['valve-ball-dn50', 'Zawór kulowy DN50', 'ZK-DN50', 62.8],
    ['valve-check-dn25', 'Zawór zwrotny DN25', 'ZZ-DN25', 42.3],
    ['valve-check-dn50', 'Zawór zwrotny DN50', 'ZZ-DN50', 68.5],
    ['valve-control-dn25', 'Zawór regulacyjny DN25', 'ZR-DN25', 85],
    ['valve-safety-dn25', 'Zawór bezpieczeństwa DN25', 'ZB-DN25', 95],
    ['valve-butterfly-dn50', 'Zawór motylkowy DN50', 'ZM-DN50', 78],
    ['valve-gate-dn50', 'Zasuwa klinowa DN50', 'ZAS-DN50', 88.4],
    ['valve-gate-dn80', 'Zasuwa klinowa DN80', 'ZAS-DN80', 114.2],
  ] as const
  const fittings = [
    ['fitting-elbow-90-dn50', 'Kolano 90° DN50', 'KOL-90-DN50', 12.4],
    ['fitting-elbow-45-dn50', 'Kolano 45° DN50', 'KOL-45-DN50', 11.8],
    ['fitting-tee-dn50', 'Trójnik DN50', 'TRJ-DN50', 18.9],
    ['fitting-reducer-50-25', 'Redukcja DN50/DN25', 'RED-50-25', 14.2],
    ['fitting-coupling-dn50', 'Mufa DN50', 'MUF-DN50', 8.5],
    ['fitting-connector-dn50', 'Złączka DN50', 'ZLC-DN50', 9.8],
    ['fitting-flange-dn50-pn16', 'Kołnierz DN50 PN16', 'KON-DN50-PN16', 22.6],
    ['fitting-flange-dn80-pn16', 'Kołnierz DN80 PN16', 'KON-DN80-PN16', 27.4],
    ['fitting-cap-dn50', 'Dennica DN50', 'DEN-DN50', 7.2],
    ['fitting-union-dn25', 'Śrubunek DN25', 'SRU-DN25', 16.4],
    ['fitting-union-dn50', 'Śrubunek DN50', 'SRU-DN50', 21.6],
    ['fitting-nipple-dn25', 'Nypel DN25', 'NYP-DN25', 5.4],
    ['fitting-nipple-dn50', 'Nypel DN50', 'NYP-DN50', 7.8],
    ['fitting-socket-dn25', 'Tuleja DN25', 'TUL-DN25', 6.2],
    ['fitting-socket-dn50', 'Tuleja DN50', 'TUL-DN50', 8.9],
    ['fitting-branch-dn80-50', 'Odgałęzienie DN80/DN50', 'ODG-80-50', 24.3],
    ['fitting-expansion-dn50', 'Kompensator DN50', 'KOM-DN50', 58.6],
    ['fitting-support-dn50', 'Uchwyt rurowy DN50', 'UCH-DN50', 13.7],
    ['fitting-support-dn80', 'Uchwyt rurowy DN80', 'UCH-DN80', 15.9],
    ['fitting-filter-dn25', 'Filtr siatkowy DN25', 'FIL-DN25', 33.8],
  ] as const
  const hardware = [
    ['hardware-bolt-m16', 'Śruba kołnierzowa M16x70', 'SRB-M16', 2.4],
    ['hardware-nut-m16', 'Nakrętka M16', 'NAK-M16', 0.8],
    ['hardware-gasket-dn50', 'Uszczelka DN50 PN16', 'USZ-DN50', 4.2],
    ['hardware-gasket-dn80', 'Uszczelka DN80 PN16', 'USZ-DN80', 5.4],
    ['hardware-washer-m16', 'Podkładka M16', 'POD-M16', 0.5],
    ['hardware-anchor-m10', 'Kotwa stalowa M10', 'KOT-M10', 3.2],
    ['hardware-clamp-dn50', 'Obejma montażowa DN50', 'OBE-DN50', 6.8],
    ['hardware-clamp-dn80', 'Obejma montażowa DN80', 'OBE-DN80', 8.1],
    ['hardware-thread-seal', 'Taśma teflonowa 12m', 'TEF-12M', 3.9],
    ['hardware-insulation-dn50', 'Otulina DN50 2m', 'OTU-DN50', 14.6],
  ] as const

  const seeds: ProductSeed[] = []

  for (const item of pipesPn16) {
    seeds.push({
      key: `pipe-dn${item.dn}-pn16`,
      title: `Rura stalowa DN${item.dn} PN16`,
      sku: `RS-DN${item.dn}-PN16`,
      basePrice: item.price,
      category: 'Rury stalowe',
      stockQuantity: item.dn === 50 ? 1200 : deriveStockQuantity(seeds.length),
    })
  }

  for (const item of pipesPn25) {
    seeds.push({
      key: `pipe-dn${item.dn}-pn25`,
      title: `Rura stalowa DN${item.dn} PN25`,
      sku: `RS-DN${item.dn}-PN25`,
      basePrice: item.price,
      category: 'Rury stalowe',
      stockQuantity: deriveStockQuantity(seeds.length),
    })
  }

  for (const item of stainlessPipes) {
    seeds.push({
      key: `pipe-stainless-dn${item.dn}`,
      title: `Rura nierdzewna DN${item.dn}`,
      sku: `RN-DN${item.dn}`,
      basePrice: item.price,
      category: 'Rury stalowe',
      stockQuantity: deriveStockQuantity(seeds.length),
    })
  }

  for (const [key, title, sku, basePrice] of valves) {
    seeds.push({
      key,
      title,
      sku,
      basePrice,
      category: 'Zawory',
      stockQuantity: sku === 'ZK-DN25' ? 850 : deriveStockQuantity(seeds.length),
    })
  }

  for (const [key, title, sku, basePrice] of fittings) {
    seeds.push({
      key,
      title,
      sku,
      basePrice,
      category: 'Kształtki',
      stockQuantity: deriveStockQuantity(seeds.length),
    })
  }

  for (const [key, title, sku, basePrice] of hardware) {
    seeds.push({
      key,
      title,
      sku,
      basePrice,
      category: 'Armatura',
      stockQuantity: deriveStockQuantity(seeds.length),
    })
  }

  return seeds
}

function deriveStockQuantity(index: number): number {
  return 100 + ((index * 137) % 1901)
}

function formatMoney(amount: number): string {
  return amount.toFixed(4)
}

function formatQuantity(quantity: number): string {
  return quantity.toFixed(4)
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

function daysFromNow(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

function monthsAgo(months: number, dayOffset: number): Date {
  const date = new Date()
  date.setMonth(date.getMonth() - months)
  date.setDate(Math.max(1, date.getDate() - dayOffset))
  return date
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
