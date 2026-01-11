import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  FmsChargeCode,
  FreightProduct,
  THCProduct,
  BAFProduct,
  BOLProduct,
  CustomsProduct,
  ContainerVariant,
  SimpleVariant,
  FmsProductPrice,
} from './data/entities'
import { SYSTEM_CHARGE_CODES } from './lib/seeds'

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

type SeedScope = {
  tenantId: string
  organizationId: string
}

async function seedChargeCodes(em: EntityManager, scope: SeedScope) {
  const created: string[] = []
  const skipped: string[] = []

  for (const systemCode of SYSTEM_CHARGE_CODES) {
    const existing = await em.findOne(FmsChargeCode, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      code: systemCode.code,
    })

    if (existing) {
      skipped.push(systemCode.code)
      continue
    }

    const chargeCode = new FmsChargeCode()
    chargeCode.organizationId = scope.organizationId
    chargeCode.tenantId = scope.tenantId
    chargeCode.code = systemCode.code
    chargeCode.name = systemCode.name
    chargeCode.description = systemCode.description
    chargeCode.chargeUnit = systemCode.chargeUnit
    chargeCode.fieldSchema = systemCode.fieldSchema
    chargeCode.sortOrder = systemCode.sortOrder
    chargeCode.isSystem = true

    em.persist(chargeCode)
    created.push(systemCode.code)
  }

  await em.flush()
  return { created, skipped }
}

async function seedTestProducts(em: EntityManager, scope: SeedScope) {
  const chargeCodes = await em.find(FmsChargeCode, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    isSystem: true,
  })

  const chargeCodeMap = new Map(chargeCodes.map((cc) => [cc.code, cc]))

  const today = new Date()
  const nextYear = new Date(today)
  nextYear.setFullYear(nextYear.getFullYear() + 1)

  const products: Array<{
    name: string
    type: string
    code: string
    variants: Array<{
      name: string
      containerSize?: string
      prices: Array<{
        price: string
        currency: string
        contractType: 'SPOT' | 'NAC' | 'BASKET'
        contractNumber?: string
      }>
    }>
    // Type-specific fields
    loop?: string
    source?: string
    destination?: string
    transitTime?: number
    location?: string
    chargeType?: 'origin' | 'destination'
    serviceType?: 'import' | 'export'
  }> = [
    // Freight Products - SHA to GDN route
    {
      name: 'MSC SWAN SHA-GDN',
      type: 'GFRT',
      code: 'GFRT',
      loop: 'MSC SWAN',
      source: 'SHA',
      destination: 'GDN',
      transitTime: 32,
      variants: [
        {
          name: 'MSC Poland',
          containerSize: '20GP',
          prices: [
            { price: '1200.00', currency: 'USD', contractType: 'SPOT' },
            { price: '1100.00', currency: 'USD', contractType: 'NAC', contractNumber: 'NAC-2024-001' },
          ],
        },
        {
          name: 'MSC Poland',
          containerSize: '40HC',
          prices: [
            { price: '2200.00', currency: 'USD', contractType: 'SPOT' },
            { price: '2000.00', currency: 'USD', contractType: 'NAC', contractNumber: 'NAC-2024-001' },
          ],
        },
      ],
    },
    {
      name: 'CMA CGM PEARL SHA-GDN',
      type: 'GFRT',
      code: 'GFRT',
      loop: 'CMA CGM PEARL',
      source: 'SHA',
      destination: 'GDN',
      transitTime: 35,
      variants: [
        {
          name: 'CMA CGM Poland',
          containerSize: '40HC',
          prices: [
            { price: '2100.00', currency: 'USD', contractType: 'SPOT' },
          ],
        },
      ],
    },
    // THC Products
    {
      name: 'THC Shanghai Origin',
      type: 'GTHC',
      code: 'GTHC',
      location: 'SHA',
      chargeType: 'origin',
      variants: [
        {
          name: 'Default',
          containerSize: '20GP',
          prices: [{ price: '150.00', currency: 'USD', contractType: 'SPOT' }],
        },
        {
          name: 'Default',
          containerSize: '40HC',
          prices: [{ price: '200.00', currency: 'USD', contractType: 'SPOT' }],
        },
      ],
    },
    {
      name: 'THC Gdansk Destination',
      type: 'GTHC',
      code: 'GTHC',
      location: 'GDN',
      chargeType: 'destination',
      variants: [
        {
          name: 'Default',
          containerSize: '20GP',
          prices: [{ price: '180.00', currency: 'EUR', contractType: 'SPOT' }],
        },
        {
          name: 'Default',
          containerSize: '40HC',
          prices: [{ price: '250.00', currency: 'EUR', contractType: 'SPOT' }],
        },
      ],
    },
    // BAF Product
    {
      name: 'Bunker Adjustment Factor',
      type: 'GBAF',
      code: 'GBAF',
      variants: [
        {
          name: 'Default',
          containerSize: '20GP',
          prices: [{ price: '350.00', currency: 'USD', contractType: 'SPOT' }],
        },
        {
          name: 'Default',
          containerSize: '40HC',
          prices: [{ price: '700.00', currency: 'USD', contractType: 'SPOT' }],
        },
      ],
    },
    // BOL Product
    {
      name: 'Bill of Lading Fee',
      type: 'GBOL',
      code: 'GBOL',
      variants: [
        {
          name: 'Default',
          prices: [{ price: '75.00', currency: 'USD', contractType: 'SPOT' }],
        },
      ],
    },
    // Customs Products
    {
      name: 'Import Customs Clearance GDN',
      type: 'GCUS',
      code: 'GCUS',
      location: 'GDN',
      serviceType: 'import',
      variants: [
        {
          name: 'Default',
          prices: [{ price: '250.00', currency: 'EUR', contractType: 'SPOT' }],
        },
      ],
    },
    {
      name: 'Export Customs Clearance SHA',
      type: 'GCUS',
      code: 'GCUS',
      location: 'SHA',
      serviceType: 'export',
      variants: [
        {
          name: 'Default',
          prices: [{ price: '150.00', currency: 'USD', contractType: 'SPOT' }],
        },
      ],
    },
  ]

  let productsCreated = 0
  let variantsCreated = 0
  let pricesCreated = 0

  for (const productDef of products) {
    const chargeCode = chargeCodeMap.get(productDef.code)
    if (!chargeCode) {
      console.warn(`Charge code ${productDef.code} not found, skipping product ${productDef.name}`)
      continue
    }

    // Create product based on type
    let product: FreightProduct | THCProduct | BAFProduct | BOLProduct | CustomsProduct

    switch (productDef.type) {
      case 'GFRT': {
        const freight = new FreightProduct()
        freight.loop = productDef.loop!
        freight.source = productDef.source!
        freight.destination = productDef.destination!
        freight.transitTime = productDef.transitTime
        product = freight
        break
      }
      case 'GTHC': {
        const thc = new THCProduct()
        thc.location = productDef.location!
        thc.chargeType = productDef.chargeType
        product = thc
        break
      }
      case 'GCUS': {
        const customs = new CustomsProduct()
        customs.location = productDef.location!
        customs.serviceType = productDef.serviceType
        product = customs
        break
      }
      case 'GBAF':
        product = new BAFProduct()
        break
      case 'GBOL':
        product = new BOLProduct()
        break
      default:
        console.warn(`Unknown product type ${productDef.type}, skipping`)
        continue
    }

    product.organizationId = scope.organizationId
    product.tenantId = scope.tenantId
    product.name = productDef.name
    product.chargeCode = chargeCode

    em.persist(product)
    productsCreated++

    // Create variants
    for (const variantDef of productDef.variants) {
      let variant: ContainerVariant | SimpleVariant

      if (variantDef.containerSize) {
        const containerVariant = new ContainerVariant()
        containerVariant.containerSize = variantDef.containerSize
        variant = containerVariant
      } else {
        variant = new SimpleVariant()
      }

      variant.organizationId = scope.organizationId
      variant.tenantId = scope.tenantId
      variant.product = product
      variant.name = variantDef.name
      variant.isDefault = variantDef.name === 'Default'

      em.persist(variant)
      variantsCreated++

      // Create prices
      for (const priceDef of variantDef.prices) {
        const price = new FmsProductPrice()
        price.organizationId = scope.organizationId
        price.tenantId = scope.tenantId
        price.variant = variant
        price.price = priceDef.price
        price.currencyCode = priceDef.currency
        price.contractType = priceDef.contractType
        price.contractNumber = priceDef.contractNumber || null
        price.validityStart = today
        price.validityEnd = nextYear

        em.persist(price)
        pricesCreated++
      }
    }
  }

  await em.flush()

  return { productsCreated, variantsCreated, pricesCreated }
}

const seedChargeCodesCommand: ModuleCli = {
  command: 'seed-charge-codes',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato products seed-charge-codes --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: SeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      const result = await em.transactional(async (tem) => {
        return seedChargeCodes(tem, scope)
      })
      console.log(`Charge codes seeded for organization ${organizationId}:`)
      console.log(`  Created: ${result.created.join(', ') || '(none)'}`)
      console.log(`  Skipped (already exist): ${result.skipped.join(', ') || '(none)'}`)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedTestProductsCommand: ModuleCli = {
  command: 'seed-test-products',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato products seed-test-products --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: SeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')

      // First ensure charge codes exist
      const chargeCodeResult = await em.transactional(async (tem) => {
        return seedChargeCodes(tem, scope)
      })
      console.log(`Charge codes: created ${chargeCodeResult.created.length}, skipped ${chargeCodeResult.skipped.length}`)

      // Then seed test products
      const productResult = await em.transactional(async (tem) => {
        return seedTestProducts(tem, scope)
      })
      console.log(`Test products seeded for organization ${organizationId}:`)
      console.log(`  Products: ${productResult.productsCreated}`)
      console.log(`  Variants: ${productResult.variantsCreated}`)
      console.log(`  Prices: ${productResult.pricesCreated}`)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedChargeCodesCommand, seedTestProductsCommand]
