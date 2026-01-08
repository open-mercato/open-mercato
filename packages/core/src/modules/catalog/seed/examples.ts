import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import {
  CatalogOffer,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductVariant,
} from '../data/entities'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { ensureCustomFieldDefinitions, type FieldSetInput } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'
import { rebuildCategoryHierarchyForOrganization } from '../lib/categoryHierarchy'
import { defineFields, cf } from '@open-mercato/shared/modules/dsl'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { ensureDefaultPartitions, resolveDefaultPartitionCode } from '@open-mercato/core/modules/attachments/lib/partitions'
import { storePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage'
import { mergeAttachmentMetadata } from '@open-mercato/core/modules/attachments/lib/metadata'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'

type SeedScope = { tenantId: string; organizationId: string }

const EXAMPLES_MEDIA_ROOT = path.join(process.cwd(), 'public', 'examples')

function detectMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

async function ensureAttachmentPartition(
  em: EntityManager,
  code: string
): Promise<AttachmentPartition> {
  let partition = await em.findOne(AttachmentPartition, { code })
  if (!partition) {
    await ensureDefaultPartitions(em)
    partition = await em.findOne(AttachmentPartition, { code })
  }
  if (!partition) {
    throw new Error(`Attachment partition "${code}" is not configured.`)
  }
  return partition
}

async function attachMediaFromExamples(
  em: EntityManager,
  scope: SeedScope,
  entityId: string,
  recordId: string,
  mediaSeeds?: MediaSeed[]
): Promise<Array<{ id: string; imageUrl: string }>> {
  if (!mediaSeeds?.length) return []
  const partitionCode = resolveDefaultPartitionCode(entityId)
  const partition = await ensureAttachmentPartition(em, partitionCode)
  const results: Array<{ id: string; imageUrl: string }> = []
  for (const media of mediaSeeds) {
    const sourcePath = path.join(EXAMPLES_MEDIA_ROOT, media.file)
    let buffer: Buffer
    try {
      buffer = await fs.readFile(sourcePath)
    } catch (error) {
      console.warn(`[catalog.seed] Example media missing: ${sourcePath}`)
      continue
    }
    const stored = await storePartitionFile({
      partitionCode: partition.code,
      orgId: scope.organizationId,
      tenantId: scope.tenantId,
      fileName: media.file,
      buffer,
    })
    const attachmentId = randomUUID()
    const slug = slugifyAttachmentFileName(media.file, 'media')
    const metadata = mergeAttachmentMetadata(null, {
      assignments: [{ type: entityId, id: recordId }],
    })
    const attachment = em.create(Attachment, {
      id: attachmentId,
      entityId,
      recordId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      partitionCode: partition.code,
      fileName: media.file,
      mimeType: detectMimeType(media.file),
      fileSize: buffer.length,
      storageDriver: partition.storageDriver || 'local',
      storagePath: stored.storagePath,
      storageMetadata: metadata,
      url: buildAttachmentFileUrl(attachmentId),
    })
    em.persist(attachment)
    results.push({
      id: attachmentId,
      imageUrl: buildAttachmentImageUrl(attachmentId, { slug }),
    })
  }
  return results
}

const PRODUCT_FIELDSETS = [
  {
    code: 'fashion_mens_footwear',
    label: 'Fashion · Men · Footwear',
    icon: 'carbon:sneaker',
    description: 'Material, construction, and care metadata for men’s performance footwear.',
    groups: [
      { code: 'identity', title: 'Identity' },
      { code: 'materials', title: 'Materials & Build' },
      { code: 'care', title: 'Care instructions' },
    ],
  },
  {
    code: 'fashion_womens_dresses',
    label: 'Fashion · Women · Dresses & Jumpsuits',
    icon: 'solar:dress-linear',
    description: 'Silhouette, fabric, and care metadata for womenswear.',
    groups: [
      { code: 'identity', title: 'Identity' },
      { code: 'materials', title: 'Materials' },
      { code: 'fit', title: 'Fit & Length' },
      { code: 'care', title: 'Care instructions' },
    ],
  },
  {
    code: 'service_booking',
    label: 'Services · Booking',
    icon: 'solar:calendar-linear',
    description: 'Scheduling, preparation, and delivery metadata for service offerings.',
    groups: [
      { code: 'identity', title: 'Identity' },
      { code: 'timing', title: 'Timing rules' },
      { code: 'resources', title: 'Resources & Delivery' },
    ],
  },
] as const

const VARIANT_FIELDSETS = [
  {
    code: 'fashion_mens_footwear',
    label: 'Fashion · Men · Footwear',
    icon: 'carbon:sneaker',
    description: 'Variant-level sizing metadata for men’s footwear.',
    groups: [
      { code: 'fit', title: 'Fit' },
      { code: 'finish', title: 'Finish' },
    ],
  },
  {
    code: 'fashion_womens_dresses',
    label: 'Fashion · Women · Dresses & Jumpsuits',
    icon: 'solar:dress-linear',
    description: 'Variant-level sizing metadata for womenswear.',
    groups: [
      { code: 'fit', title: 'Fit' },
      { code: 'finish', title: 'Finish' },
    ],
  },
  {
    code: 'service_booking',
    label: 'Services · Booking',
    icon: 'solar:calendar-linear',
    description: 'Provider, duration, and environment metadata for service slots.',
    groups: [
      { code: 'provider', title: 'Provider' },
      { code: 'environment', title: 'Environment' },
    ],
  },
] as const

const CUSTOM_FIELD_SETS: FieldSetInput[] = [
  defineFields(E.catalog.catalog_product, [
    cf.text('style_code', {
      label: 'Style code',
      description: 'Reference code shared with merchandising teams.',
      filterable: true,
      fieldset: 'fashion_mens_footwear',
      group: { code: 'identity' },
    }),
    cf.select('upper_material', ['engineered_knit', 'full_grain_leather', 'recycled_mesh'], {
      label: 'Upper material',
      fieldset: 'fashion_mens_footwear',
      group: { code: 'materials' },
      filterable: true,
    }),
    cf.select('cushioning_profile', ['responsive', 'plush', 'stability'], {
      label: 'Cushioning profile',
      fieldset: 'fashion_mens_footwear',
      group: { code: 'materials' },
    }),
    cf.multiline('care_notes', {
      label: 'Care notes',
      editor: 'markdown',
      fieldset: 'fashion_mens_footwear',
      group: { code: 'care' },
    }),
  ]),
  defineFields(E.catalog.catalog_product, [
    cf.select('silhouette', ['wrap', 'column', 'fit_and_flare', 'jumpsuit'], {
      label: 'Silhouette',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'identity' },
      filterable: true,
    }),
    cf.select('fabric_mix', ['silk_blend', 'recycled_poly', 'linen', 'cupro'], {
      label: 'Fabric mix',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'materials' },
    }),
    cf.select('occasion_ready', ['daytime', 'evening', 'resort'], {
      label: 'Occasion',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'fit' },
    }),
    cf.multiline('finishing_details', {
      label: 'Finishing details',
      editor: 'markdown',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'care' },
    }),
  ]),
  defineFields(E.catalog.catalog_product_variant, [
    cf.integer('shoe_size', {
      label: 'US size',
      fieldset: 'fashion_mens_footwear',
      group: { code: 'fit' },
      filterable: true,
    }),
    cf.select('shoe_width', ['B', 'D', 'EE'], {
      label: 'Width',
      fieldset: 'fashion_mens_footwear',
      group: { code: 'fit' },
    }),
    cf.text('colorway', {
      label: 'Colorway',
      fieldset: 'fashion_mens_footwear',
      group: { code: 'finish' },
    }),
  ]),
  defineFields(E.catalog.catalog_product_variant, [
    cf.integer('numeric_size', {
      label: 'Numeric size',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'fit' },
    }),
    cf.select('length_profile', ['mini', 'midi', 'maxi'], {
      label: 'Length',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'fit' },
    }),
    cf.text('color_story', {
      label: 'Color story',
      fieldset: 'fashion_womens_dresses',
      group: { code: 'finish' },
    }),
  ]),
  defineFields(E.catalog.catalog_product, [
    cf.integer('service_duration_minutes', {
      label: 'Duration (minutes)',
      description: 'Length of a single booking slot.',
      fieldset: 'service_booking',
      group: { code: 'timing' },
      filterable: true,
      required: true,
    }),
    cf.integer('service_buffer_minutes', {
      label: 'Buffer between appointments',
      description: 'Minimum downtime between consecutive bookings (minutes).',
      fieldset: 'service_booking',
      group: { code: 'timing' },
    }),
    cf.text('service_location', {
      label: 'Location / Room',
      description: 'Where the service is delivered.',
      fieldset: 'service_booking',
      group: { code: 'identity' },
    }),
    cf.select('service_resources', ['stylist', 'therapist', 'treatment_room', 'wash_station', 'steam_room'], {
      label: 'Required resources',
      description: 'Staff or rooms required to perform the service.',
      fieldset: 'service_booking',
      group: { code: 'resources' },
      multi: true,
    }),
    cf.boolean('service_remote_available', {
      label: 'Remote session available',
      description: 'Indicates whether the service can be performed remotely or virtually.',
      fieldset: 'service_booking',
      group: { code: 'resources' },
      defaultValue: false,
    }),
  ]),
  defineFields(E.catalog.catalog_product_variant, [
    cf.select('provider_level', ['junior', 'senior', 'master'], {
      label: 'Provider level',
      description: 'Seniority of the assigned specialist.',
      fieldset: 'service_booking',
      group: { code: 'provider' },
      filterable: true,
    }),
    cf.text('staff_member', {
      label: 'Staff member',
      description: 'Optional name of the staff member who usually delivers this variant.',
      fieldset: 'service_booking',
      group: { code: 'provider' },
    }),
    cf.select('environment_type', ['studio', 'suite', 'on_site'], {
      label: 'Environment',
      description: 'Where the session is hosted.',
      fieldset: 'service_booking',
      group: { code: 'environment' },
    }),
  ]),
]

type CategorySeed = {
  slug: string
  name: string
  description?: string
  children?: CategorySeed[]
}

const CATEGORY_TREE: CategorySeed[] = [
  {
    slug: 'fashion',
    name: 'Fashion',
    description: 'Seasonal assortments and vertical-specific collections.',
    children: [
      {
        slug: 'fashion-men',
        name: 'Men',
        children: [
          {
            slug: 'fashion-men-footwear',
            name: 'Footwear',
            description: 'Premium sneakers, boots, and sandals.',
          },
        ],
      },
      {
        slug: 'fashion-women',
        name: 'Women',
        children: [
          {
            slug: 'fashion-women-dresses-jumpsuits',
            name: 'Dresses & Jumpsuits',
            description: 'Occasion-ready dresses and tailored jumpsuits.',
          },
        ],
      },
    ],
  },
  {
    slug: 'services',
    name: 'Services',
    description: 'Bookable in-person and virtual experiences.',
    children: [
      {
        slug: 'services-hairdresser',
        name: 'Hairdresser',
        description: 'Salon services ranging from quick trims to signature looks.',
      },
      {
        slug: 'services-massage',
        name: 'Massage',
        description: 'Wellness treatments and bodywork sessions.',
      },
    ],
  },
]

type MediaSeed = {
  file: string
  title?: string
}

type VariantSeed = {
  name: string
  sku: string
  isDefault?: boolean
  optionValues?: Record<string, string>
  prices: {
    regular: number
    sale?: number
  }
  customFields?: Record<string, string | number | boolean | null>
  media?: MediaSeed[]
}

type ProductSeed = {
  title: string
  handle: string
  sku?: string
  description: string
  categorySlug: string
  customFieldsetCode: string
  variantFieldsetCode: string
  unit: string
  metadata?: Record<string, unknown>
  customFields?: Record<string, string | number | boolean | null>
  media?: MediaSeed[]
  variants: VariantSeed[]
}

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    title: 'Atlas Runner Sneaker',
    handle: 'atlas-runner-sneaker',
    sku: 'ATLAS-RUNNER',
    description:
      'Lightweight road sneaker engineered with a breathable knit upper, recycled TPU overlays, and a decoupled heel for smooth transitions.',
    categorySlug: 'fashion-men-footwear',
    customFieldsetCode: 'fashion_mens_footwear',
    variantFieldsetCode: 'fashion_mens_footwear',
    unit: 'pair',
    metadata: { division: 'RunLab', season: 'SS25' },
    customFields: {
      style_code: 'AR-2025',
      upper_material: 'engineered_knit',
      cushioning_profile: 'responsive',
      care_notes: 'Spot clean after each run and air dry. Avoid machine drying.',
    },
    media: [
      { file: 'atlas-runner-midnight-1.png' },
    ],
    variants: [
      {
        name: 'Midnight Navy · US 8',
        sku: 'ATLAS-RUN-NAVY-8',
        isDefault: true,
        optionValues: { color: 'Midnight Navy', size: 'US 8' },
        prices: { regular: 168, sale: 148 },
        customFields: { shoe_size: 8, shoe_width: 'D', colorway: 'Midnight Navy' },
        media: [
          { file: 'atlas-runner-midnight-1.png' },
          { file: 'atlas-runner-midnight-2.png' },
        ],
      },
      {
        name: 'Glacier Grey · US 10',
        sku: 'ATLAS-RUN-GLACIER-10',
        optionValues: { color: 'Glacier Grey', size: 'US 10' },
        prices: { regular: 168, sale: 138 },
        customFields: { shoe_size: 10, shoe_width: 'EE', colorway: 'Glacier Grey' },
        media: [
          { file: 'atlas-runner-glacier-1.png' },
          { file: 'atlas-runner-glacier-2.png' },
        ],
      },
    ],
  },
  {
    title: 'Aurora Wrap Dress',
    handle: 'aurora-wrap-dress',
    sku: 'AURORA-WRAP',
    description:
      'Bias-cut wrap dress with blouson sleeves, matte silk blend, and hidden interior snaps so the placket stays put at events.',
    categorySlug: 'fashion-women-dresses-jumpsuits',
    customFieldsetCode: 'fashion_womens_dresses',
    variantFieldsetCode: 'fashion_womens_dresses',
    unit: 'unit',
    metadata: { capsule: 'Evening Atelier', season: 'Resort 25' },
    customFields: {
      silhouette: 'wrap',
      fabric_mix: 'silk_blend',
      occasion_ready: 'evening',
      finishing_details: 'Hand-finished hem with subtle tonal beading along the wrap edge.',
    },
    media: [
      { file: 'aurora-wrap-rosewood.png' },
    ],
    variants: [
      {
        name: 'Rosewood · Medium',
        sku: 'AURORA-ROSE-M',
        isDefault: true,
        optionValues: { color: 'Rosewood', size: 'Medium' },
        prices: { regular: 248, sale: 212 },
        customFields: { numeric_size: 6, length_profile: 'midi', color_story: 'Rosewood' },
        media: [
          { file: 'aurora-wrap-rosewood.png' },
        ],
      },
      {
        name: 'Celestial · Large',
        sku: 'AURORA-CELESTIAL-L',
        optionValues: { color: 'Celestial', size: 'Large' },
        prices: { regular: 248, sale: 198 },
        customFields: { numeric_size: 8, length_profile: 'maxi', color_story: 'Celestial blue' },
        media: [
          { file: 'aurora-wrap-celestial.png' },
        ],
      },
    ],
  },
  {
    title: 'Signature Haircut & Finish',
    handle: 'signature-haircut-service',
    sku: 'SERV-HAIR-60',
    description:
      'Tailored haircut with relaxing wash, scalp massage, and styling finish. Designed for repeat bookings in the demo portal.',
    categorySlug: 'services-hairdresser',
    customFieldsetCode: 'service_booking',
    variantFieldsetCode: 'service_booking',
    unit: 'hour',
    metadata: { channel: 'salon', serviceType: 'hairdresser' },
    customFields: {
      service_duration_minutes: 60,
      service_buffer_minutes: 15,
      service_location: 'Salon Studio 3',
      service_resources: 'stylist,wash_station',
      service_remote_available: false,
    },
    media: [{ file: 'hairdresser-service.png' }],
    variants: [
      {
        name: 'Senior Stylist · 60 min',
        sku: 'SERV-HAIR-60-SENIOR',
        isDefault: true,
        optionValues: { stylist: 'Senior', duration: '60' },
        prices: { regular: 95, sale: 85 },
        customFields: {
          provider_level: 'senior',
          staff_member: 'Amelia Hart',
          environment_type: 'studio',
        },
        media: [{ file: 'hairdresser-service.png' }],
      },
    ],
  },
  {
    title: 'Restorative Massage Session',
    handle: 'restorative-massage-service',
    sku: 'SERV-MASSAGE-90',
    description:
      'Full-body massage with aromatherapy oils and guided breathing. Includes complimentary refreshments and studio amenities.',
    categorySlug: 'services-massage',
    customFieldsetCode: 'service_booking',
    variantFieldsetCode: 'service_booking',
    unit: 'hour',
    metadata: { channel: 'wellness', serviceType: 'massage' },
    customFields: {
      service_duration_minutes: 90,
      service_buffer_minutes: 20,
      service_location: 'Wellness Suite B',
      service_resources: 'therapist,treatment_room,steam_room',
      service_remote_available: false,
    },
    media: [{ file: 'massage-service.png' }],
    variants: [
      {
        name: 'Master Therapist · 90 min',
        sku: 'SERV-MASSAGE-90-MASTER',
        isDefault: true,
        optionValues: { therapist: 'Master', duration: '90' },
        prices: { regular: 140, sale: 120 },
        customFields: {
          provider_level: 'master',
          staff_member: 'Noah Li',
          environment_type: 'suite',
        },
        media: [{ file: 'massage-service.png' }],
      },
    ],
  },
]

const CHANNEL_DEFINITION = {
  code: 'fashion-online',
  name: 'Mercato Fashion Online',
  description: 'Direct-to-consumer storefront showcasing premium demos.',
  websiteUrl: 'https://demo.open-mercato.com',
  contactEmail: 'store@open-mercato.com',
}

function formatMoney(value: number): string {
  return value.toFixed(2)
}

async function resolveDefaultTaxRate(
  em: EntityManager,
  scope: SeedScope
): Promise<SalesTaxRate | null> {
  const [rate] = await em.find(
    SalesTaxRate,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {
      limit: 1,
      orderBy: {
        isDefault: 'DESC',
        priority: 'ASC',
        rate: 'DESC',
        createdAt: 'ASC',
      },
    }
  )
  return rate ?? null
}

async function ensureFieldsetConfig(
  em: EntityManager,
  scope: SeedScope,
  entityId: string,
  fieldsets: typeof PRODUCT_FIELDSETS | typeof VARIANT_FIELDSETS
): Promise<void> {
  const now = new Date()
  let config = await em.findOne(CustomFieldEntityConfig, {
    entityId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!config) {
    config = em.create(CustomFieldEntityConfig, {
      id: randomUUID(),
      entityId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }
  config.configJson = {
    fieldsets,
    singleFieldsetPerRecord: true,
  }
  config.isActive = true
  config.updatedAt = now
  em.persist(config)
}

async function ensureFieldsetsAndDefinitions(em: EntityManager, scope: SeedScope): Promise<void> {
  await ensureFieldsetConfig(em, scope, E.catalog.catalog_product, PRODUCT_FIELDSETS)
  await ensureFieldsetConfig(em, scope, E.catalog.catalog_product_variant, VARIANT_FIELDSETS)
  await ensureCustomFieldDefinitions(em, CUSTOM_FIELD_SETS, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.flush()
}

async function ensureCategories(
  em: EntityManager,
  scope: SeedScope
): Promise<Map<string, CatalogProductCategory>> {
  const map = new Map<string, CatalogProductCategory>()
  const now = new Date()

  const upsert = async (seed: CategorySeed, parent: CatalogProductCategory | null) => {
    let record = await em.findOne(CatalogProductCategory, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      slug: seed.slug,
    })
    if (!record) {
      record = em.create(CatalogProductCategory, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: seed.name,
        slug: seed.slug,
        description: seed.description ?? null,
        parentId: parent ? parent.id : null,
        rootId: parent ? parent.rootId ?? parent.id : null,
        treePath: null,
        depth: parent ? (parent.depth ?? 0) + 1 : 0,
        ancestorIds: [],
        childIds: [],
        descendantIds: [],
        metadata: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(record)
    } else {
      record.name = seed.name
      record.description = seed.description ?? null
      record.parentId = parent ? parent.id : null
      record.isActive = true
      record.updatedAt = now
    }
    map.set(seed.slug, record)
    if (Array.isArray(seed.children)) {
      for (const child of seed.children) {
        await upsert(child, record)
      }
    }
  }

  for (const seed of CATEGORY_TREE) {
    await upsert(seed, null)
  }

  await em.flush()
  await rebuildCategoryHierarchyForOrganization(em, scope.organizationId, scope.tenantId)

  return map
}

async function ensureChannel(em: EntityManager, scope: SeedScope): Promise<SalesChannel> {
  const now = new Date()
  let channel = await em.findOne(SalesChannel, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code: CHANNEL_DEFINITION.code,
    deletedAt: null,
  })
  if (!channel) {
    channel = em.create(SalesChannel, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      code: CHANNEL_DEFINITION.code,
      name: CHANNEL_DEFINITION.name,
      description: CHANNEL_DEFINITION.description,
      websiteUrl: CHANNEL_DEFINITION.websiteUrl,
      contactEmail: CHANNEL_DEFINITION.contactEmail,
      status: 'active',
      isActive: true,
      metadata: { locale: 'en-US' },
      createdAt: now,
      updatedAt: now,
    })
    em.persist(channel)
    await em.flush()
  }
  return channel
}

async function loadPriceKinds(
  em: EntityManager,
  scope: SeedScope
): Promise<Map<string, CatalogPriceKind>> {
  const kinds = await em.find(CatalogPriceKind, {
    tenantId: scope.tenantId,
    code: { $in: ['regular', 'sale'] },
    deletedAt: null,
  })
  const map = new Map<string, CatalogPriceKind>()
  for (const kind of kinds) {
    map.set(kind.code.toLowerCase(), kind)
  }
  return map
}

export async function seedCatalogExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope
): Promise<boolean> {
  await ensureFieldsetsAndDefinitions(em, scope)
  await ensureDefaultPartitions(em)

  const handles = PRODUCT_SEEDS.map((seed) => seed.handle)
  const existingProducts = await em.find(CatalogProduct, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    handle: { $in: handles as any },
  })
  const existingByHandle = new Map(existingProducts.map((product) => [product.handle?.toLowerCase(), product]))

  const categoryMap = await ensureCategories(em, scope)
  const channel = await ensureChannel(em, scope)
  const priceKinds = await loadPriceKinds(em, scope)
  const regularKind = priceKinds.get('regular')
  const saleKind = priceKinds.get('sale')
  const defaultTaxRate = await resolveDefaultTaxRate(em, scope)
  const defaultTaxRateId = defaultTaxRate?.id ?? null
  const defaultTaxRateValue = defaultTaxRate?.rate ?? null
  if (!regularKind || !saleKind) {
    throw new Error('Missing catalog price kinds; run `mercato catalog seed-price-kinds` first.')
  }

  const dataEngine = new DefaultDataEngine(em, container)
  const customFieldAssignments: Array<() => Promise<void>> = []
  let createdAny = false

  for (const productSeed of PRODUCT_SEEDS) {
    const existing = existingByHandle.get(productSeed.handle.toLowerCase())
    if (existing) {
      continue
    }
    createdAny = true
    const product = em.create(CatalogProduct, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: productSeed.title,
      description: productSeed.description,
      sku: productSeed.sku ?? null,
      handle: productSeed.handle,
      productType: 'configurable',
      primaryCurrencyCode: 'USD',
      defaultUnit: productSeed.unit,
      customFieldsetCode: productSeed.customFieldsetCode,
      metadata: productSeed.metadata ?? null,
      taxRateId: defaultTaxRateId,
      taxRate: defaultTaxRateValue,
      isConfigurable: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(product)

    const category = categoryMap.get(productSeed.categorySlug)
    if (category) {
      const assignment = em.create(CatalogProductCategoryAssignment, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        product,
        category,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(assignment)
    }

    const offer = em.create(CatalogOffer, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      product,
      channelId: channel.id,
      title: `${productSeed.title} · Online`,
      description: 'Offer curated for the demo storefront channel.',
      metadata: { channelCode: CHANNEL_DEFINITION.code },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(offer)

    if (productSeed.customFields && Object.keys(productSeed.customFields).length) {
      const payload = { ...productSeed.customFields }
      customFieldAssignments.push(() =>
        dataEngine.setCustomFields({
          entityId: E.catalog.catalog_product,
          recordId: product.id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          values: payload,
        })
      )
    }

    const productMedia = await attachMediaFromExamples(
      em,
      scope,
      E.catalog.catalog_product,
      product.id,
      productSeed.media
    )
    if (productMedia.length) {
      const hero = productMedia[0]
      product.defaultMediaId = hero.id
      product.defaultMediaUrl = hero.imageUrl
      offer.defaultMediaId = hero.id
      offer.defaultMediaUrl = hero.imageUrl
    }

    for (const variantSeed of productSeed.variants) {
      const variant = em.create(CatalogProductVariant, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        product,
        name: variantSeed.name,
        sku: variantSeed.sku,
        isDefault: variantSeed.isDefault ?? false,
        optionValues: variantSeed.optionValues ?? null,
        customFieldsetCode: productSeed.variantFieldsetCode,
        metadata: null,
        taxRateId: defaultTaxRateId,
        taxRate: defaultTaxRateValue,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(variant)

      const variantMedia = await attachMediaFromExamples(
        em,
        scope,
        E.catalog.catalog_product_variant,
        variant.id,
        variantSeed.media
      )
      const variantCover = variantMedia[0] ?? productMedia[0]

      const regularPrice = em.create(CatalogProductPrice, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        product,
        variant,
        offer,
        priceKind: regularKind,
        currencyCode: 'USD',
        kind: regularKind.code,
        minQuantity: 1,
        taxRate: defaultTaxRateValue,
        unitPriceGross: formatMoney(variantSeed.prices.regular),
        unitPriceNet: formatMoney(variantSeed.prices.regular),
        channelId: channel.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(regularPrice)

      if (variantSeed.prices.sale !== undefined) {
        const salePrice = em.create(CatalogProductPrice, {
          id: randomUUID(),
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          product,
          variant,
          offer,
          priceKind: saleKind,
          currencyCode: 'USD',
          kind: saleKind.code,
          minQuantity: 1,
          taxRate: defaultTaxRateValue,
          unitPriceGross: formatMoney(variantSeed.prices.sale),
          unitPriceNet: formatMoney(variantSeed.prices.sale),
          channelId: channel.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(salePrice)
      }

      if (variantSeed.customFields && Object.keys(variantSeed.customFields).length) {
        const payload = { ...variantSeed.customFields }
        customFieldAssignments.push(() =>
          dataEngine.setCustomFields({
            entityId: E.catalog.catalog_product_variant,
            recordId: variant.id,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            values: payload,
          })
        )
      }
    }
  }

  if (!createdAny) {
    return false
  }

  await em.flush()

  for (const assign of customFieldAssignments) {
    try {
      await assign()
    } catch (err) {
      console.warn('[catalog.seed] Failed to set example custom field values', err)
    }
  }

  return true
}
