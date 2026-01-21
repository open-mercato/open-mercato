import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { CustomFieldEntityConfig, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { ResourcesResource, ResourcesResourceTag, ResourcesResourceTagAssignment, ResourcesResourceType } from '../data/entities'
import { E } from '#generated/entities.ids.generated'
import {
  RESOURCES_RESOURCE_CUSTOM_FIELD_SETS,
  RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR,
  RESOURCES_RESOURCE_FIELDSETS,
  RESOURCES_RESOURCE_FIELDSET_HAIR_KIT,
  RESOURCES_RESOURCE_FIELDSET_LAPTOP,
  RESOURCES_RESOURCE_FIELDSET_ROOM,
  RESOURCES_RESOURCE_FIELDSET_SEAT,
  RESOURCES_RESOURCE_FIELDSET_VEHICLE,
  resolveResourcesResourceFieldsetCode,
} from './resourceCustomFields'
import { RESOURCES_CAPACITY_UNIT_DEFAULTS, RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY } from './capacityUnits'

export type ResourcesSeedScope = { tenantId: string; organizationId: string }

type ResourcesResourceTypeSeed = {
  key: string
  name: string
  description?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type ResourcesResourceTagSeed = {
  key: string
  slug: string
  label: string
  color?: string | null
  description?: string | null
}

type ResourcesResourceSeed = {
  key: string
  name: string
  typeKey?: string | null
  tagKeys: string[]
}

async function ensureResourceFieldsetConfig(em: EntityManager, scope: ResourcesSeedScope) {
  const now = new Date()
  let config = await em.findOne(CustomFieldEntityConfig, {
    entityId: E.resources.resources_resource,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!config) {
    config = em.create(CustomFieldEntityConfig, {
      entityId: E.resources.resources_resource,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }
  config.configJson = {
    fieldsets: RESOURCES_RESOURCE_FIELDSETS,
    singleFieldsetPerRecord: true,
  }
  config.isActive = true
  config.updatedAt = now
  em.persist(config)
}

async function ensureResourceCustomFields(em: EntityManager, scope: ResourcesSeedScope) {
  await ensureResourceFieldsetConfig(em, scope)
  await ensureCustomFieldDefinitions(em, RESOURCES_RESOURCE_CUSTOM_FIELD_SETS, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.flush()
}

export async function seedResourcesCapacityUnits(
  em: EntityManager,
  scope: ResourcesSeedScope,
) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY,
      name: 'Resource capacity units',
      description: 'Units for resource capacity (spots, units, quantity, etc.).',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default' satisfies DictionaryManagerVisibility,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }

  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingMap = new Map(existingEntries.map((entry) => [entry.normalizedValue, entry]))
  for (const unit of RESOURCES_CAPACITY_UNIT_DEFAULTS) {
    const normalized = unit.value.trim().toLowerCase()
    if (!normalized || existingMap.has(normalized)) continue
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      value: unit.value,
      normalizedValue: normalized,
      label: unit.label,
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
  await em.flush()
}

function normalizeAssetTag(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'RESOURCE'
  const upper = trimmed.toUpperCase()
  const normalized = upper.replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'RESOURCE'
}

function buildBaseResourceCustomValues(
  resourceName: string,
  seedKey?: string | null,
): Record<string, string | number | boolean | null> {
  const tagSource = seedKey?.trim().length ? seedKey : resourceName
  const assetTag = normalizeAssetTag(tagSource ?? resourceName)
  return {
    asset_tag: assetTag,
    owner: 'Operations',
    warranty_expires: '2026-12-31',
    ops_notes: `Seeded for ${resourceName}.`,
  }
}

function buildResourceTypeCustomValues(
  fieldsetCode: string,
  seedKey?: string | null,
): Record<string, string | number | boolean | null> {
  switch (fieldsetCode) {
    case RESOURCES_RESOURCE_FIELDSET_ROOM:
      return {
        room_floor: '1',
        room_zone: 'North Wing',
        room_projector: true,
        room_whiteboard: true,
        room_access_notes: 'Keycard access required after 6pm.',
      }
    case RESOURCES_RESOURCE_FIELDSET_LAPTOP: {
      const serialSource = seedKey?.trim().length ? seedKey : 'resource'
      return {
        laptop_serial: `LT-${normalizeAssetTag(serialSource)}`,
        laptop_cpu: 'Intel i7',
        laptop_ram_gb: 16,
        laptop_storage_gb: 512,
        laptop_os: 'windows',
        laptop_accessories: 'Docking station, charger, spare mouse.',
      }
    }
    case RESOURCES_RESOURCE_FIELDSET_SEAT:
      return {
        seat_style: 'standard',
        seat_heated: false,
        seat_positioning: 'Adjust headrest for extended sessions.',
      }
    case RESOURCES_RESOURCE_FIELDSET_HAIR_KIT:
      return {
        kit_inventory: 'Shears, clippers, comb set, cape, spray bottle.',
        kit_restock_cycle: 'Monthly',
        kit_maintenance: 'Replace clipper blades every quarter.',
      }
    case RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR:
      return {
        chair_model: 'DX-300',
        chair_ultrasonic: true,
        chair_last_disinfected: '2025-01-01',
        chair_inspection_notes: 'Monthly inspection scheduled.',
      }
    case RESOURCES_RESOURCE_FIELDSET_VEHICLE:
      return buildVehicleCustomValues(seedKey)
    default:
      return {}
  }
}

type VehicleSeedDetails = {
  model: string
  plate: string
  fuelType: string
  mileageKm: number
  lastService: string
}

const VEHICLE_SEED_DETAILS: Record<string, VehicleSeedDetails> = {
  'company-car-1': {
    model: 'Tesla Model 3',
    plate: 'WWA 4K32',
    fuelType: 'electric',
    mileageKm: 18240,
    lastService: '2025-02-18',
  },
  'company-car-2': {
    model: 'Volvo XC40 Recharge',
    plate: 'WPR 9L18',
    fuelType: 'electric',
    mileageKm: 22610,
    lastService: '2024-12-05',
  },
}

function buildVehicleCustomValues(seedKey?: string | null): Record<string, string | number | boolean | null> {
  const details = seedKey ? VEHICLE_SEED_DETAILS[seedKey] : undefined
  if (!details) {
    return {
      vehicle_plate: 'OM-2034',
      vehicle_model: 'Polestar 2',
      vehicle_fuel_type: 'electric',
      vehicle_mileage_km: 18200,
      vehicle_last_service: '2025-02-18',
    }
  }
  return {
    vehicle_plate: details.plate,
    vehicle_model: details.model,
    vehicle_fuel_type: details.fuelType,
    vehicle_mileage_km: details.mileageKm,
    vehicle_last_service: details.lastService,
  }
}

async function fillMissingResourceCustomFields(
  em: EntityManager,
  scope: ResourcesSeedScope,
  resource: ResourcesResource,
  customValues: Record<string, string | number | boolean | null>,
) {
  const keys = Object.keys(customValues)
  if (!keys.length) return
  const existingValues = await em.find(CustomFieldValue, {
    entityId: E.resources.resources_resource,
    recordId: resource.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    fieldKey: { $in: keys },
  })
  const existingKeys = new Set(existingValues.map((value) => value.fieldKey))
  const missingValues: Record<string, string | number | boolean | null> = {}
  for (const key of keys) {
    if (!existingKeys.has(key)) {
      missingValues[key] = customValues[key] ?? null
    }
  }
  if (Object.keys(missingValues).length === 0) return
  await setRecordCustomFields(em, {
    entityId: E.resources.resources_resource,
    recordId: resource.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    values: missingValues,
  })
}

const RESOURCE_TYPE_SEEDS: ResourcesResourceTypeSeed[] = [
  {
    key: 'meeting_room',
    name: 'Meeting room',
    description: 'Collaborative space with A/V equipment.',
    appearanceIcon: 'lucide:video',
    appearanceColor: '#2563eb',
  },
  {
    key: 'focus_room',
    name: 'Focus room',
    description: 'Quiet room for heads-down work.',
    appearanceIcon: 'lucide:door-closed',
    appearanceColor: '#0ea5e9',
  },
  {
    key: 'laptop',
    name: 'Engineering laptop',
    description: 'Portable computer for the delivery team.',
    appearanceIcon: 'lucide:cpu',
    appearanceColor: '#14b8a6',
  },
  {
    key: 'company_car',
    name: 'Company car',
    description: 'Shared vehicle for client visits and errands.',
    appearanceIcon: 'lucide:car',
    appearanceColor: '#7c3aed',
  },
]

const TAG_SEEDS: ResourcesResourceTagSeed[] = [
  { key: 'room', slug: 'room', label: 'Room', color: '#1d4ed8' },
  { key: 'focus', slug: 'focus', label: 'Focus', color: '#0f766e' },
  { key: 'tech', slug: 'tech', label: 'Tech', color: '#2563eb' },
  { key: 'equipment', slug: 'equipment', label: 'Equipment', color: '#6b21a8' },
  { key: 'vehicle', slug: 'vehicle', label: 'Vehicle', color: '#7c3aed' },
  { key: 'collaboration', slug: 'collaboration', label: 'Collaboration', color: '#14b8a6' },
]

const RESOURCE_SEEDS: ResourcesResourceSeed[] = [
  { key: 'meeting-room-a', name: 'Meeting Room A', typeKey: 'meeting_room', tagKeys: ['room', 'collaboration'] },
  { key: 'meeting-room-b', name: 'Meeting Room B', typeKey: 'meeting_room', tagKeys: ['room', 'collaboration'] },
  { key: 'focus-room-1', name: 'Focus Room 1', typeKey: 'focus_room', tagKeys: ['room', 'focus'] },
  { key: 'focus-room-2', name: 'Focus Room 2', typeKey: 'focus_room', tagKeys: ['room', 'focus'] },
  { key: 'engineering-laptop-1', name: 'Engineering Laptop 1', typeKey: 'laptop', tagKeys: ['tech', 'equipment'] },
  { key: 'engineering-laptop-2', name: 'Engineering Laptop 2', typeKey: 'laptop', tagKeys: ['tech', 'equipment'] },
  { key: 'company-car-1', name: 'Tesla Model 3 - WWA 4K32', typeKey: 'company_car', tagKeys: ['vehicle'] },
  { key: 'company-car-2', name: 'Volvo XC40 Recharge - WPR 9L18', typeKey: 'company_car', tagKeys: ['vehicle'] },
]

export async function seedResourcesResourceExamples(
  em: EntityManager,
  scope: ResourcesSeedScope,
) {
  const now = new Date()
  await ensureResourceCustomFields(em, scope)
  const typeNames = RESOURCE_TYPE_SEEDS.map((seed) => seed.name)
  const existingTypes = await findWithDecryption(
    em,
    ResourcesResourceType,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: { $in: typeNames },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const typeByName = new Map(existingTypes.map((type) => [type.name.toLowerCase(), type]))
  const typeByKey = new Map<string, ResourcesResourceType>()
  for (const seed of RESOURCE_TYPE_SEEDS) {
    const existing = typeByName.get(seed.name.toLowerCase())
    if (existing) {
      if (!existing.appearanceIcon && seed.appearanceIcon) {
        existing.appearanceIcon = seed.appearanceIcon
      }
      if (!existing.appearanceColor && seed.appearanceColor) {
        existing.appearanceColor = seed.appearanceColor
      }
      if (existing.appearanceIcon || existing.appearanceColor) {
        existing.updatedAt = now
        em.persist(existing)
      }
      typeByKey.set(seed.key, existing)
      continue
    }
    const record = em.create(ResourcesResourceType, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      description: seed.description ?? null,
      appearanceIcon: seed.appearanceIcon ?? null,
      appearanceColor: seed.appearanceColor ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    typeByKey.set(seed.key, record)
  }
  await em.flush()

  const allTypes = await findWithDecryption(
    em,
    ResourcesResourceType,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const typeNameById = new Map(allTypes.map((type) => [type.id, type.name]))

  const tagSlugs = TAG_SEEDS.map((seed) => seed.slug)
  const existingTags = await findWithDecryption(
    em,
    ResourcesResourceTag,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      slug: { $in: tagSlugs },
    },
    undefined,
    scope,
  )
  const tagBySlug = new Map(existingTags.map((tag) => [tag.slug.toLowerCase(), tag]))
  const tagByKey = new Map<string, ResourcesResourceTag>()
  for (const seed of TAG_SEEDS) {
    const existing = tagBySlug.get(seed.slug.toLowerCase())
    if (existing) {
      tagByKey.set(seed.key, existing)
      continue
    }
    const tag = em.create(ResourcesResourceTag, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      slug: seed.slug,
      label: seed.label,
      color: seed.color ?? null,
      description: seed.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(tag)
    tagByKey.set(seed.key, tag)
  }
  await em.flush()

  const resourceNames = RESOURCE_SEEDS.map((seed) => seed.name)
  const existingResources = await findWithDecryption(
    em,
    ResourcesResource,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: { $in: resourceNames },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const resourceByName = new Map(existingResources.map((resource) => [resource.name.toLowerCase(), resource]))
  const resourceByKey = new Map<string, ResourcesResource>()
  for (const seed of RESOURCE_SEEDS) {
    const existing = resourceByName.get(seed.name.toLowerCase())
    if (existing) {
      if (!existing.resourceTypeId && seed.typeKey) {
        const typeId = typeByKey.get(seed.typeKey)?.id ?? null
        if (typeId) {
          existing.resourceTypeId = typeId
          existing.updatedAt = now
          em.persist(existing)
        }
      }
      resourceByKey.set(seed.key, existing)
      continue
    }
    const resourceTypeId = seed.typeKey ? typeByKey.get(seed.typeKey)?.id ?? null : null
    const resource = em.create(ResourcesResource, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      resourceTypeId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(resource)
    resourceByKey.set(seed.key, resource)
  }
  await em.flush()

  const resourcesInScope = await findWithDecryption(
    em,
    ResourcesResource,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const seedKeyByName = new Map(RESOURCE_SEEDS.map((seed) => [seed.name.toLowerCase(), seed.key]))
  for (const resource of resourcesInScope) {
    const resourceName = resource.name ?? 'Resource'
    const seedKey = seedKeyByName.get(resourceName.toLowerCase()) ?? null
    const typeName = resource.resourceTypeId ? typeNameById.get(resource.resourceTypeId) ?? null : null
    const fieldsetCode = resolveResourcesResourceFieldsetCode(typeName ?? resourceName)
    const customValues = {
      ...buildBaseResourceCustomValues(resourceName, seedKey),
      ...buildResourceTypeCustomValues(fieldsetCode, seedKey),
    }
    await fillMissingResourceCustomFields(em, scope, resource, customValues)
  }

  const resourceList = Array.from(resourceByKey.values())
  if (resourceList.length > 0) {
    const existingAssignments = await findWithDecryption(
      em,
      ResourcesResourceTagAssignment,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        resource: { $in: resourceList.map((resource) => resource.id) },
      },
      { populate: ['resource', 'tag'] },
      scope,
    )
    const assignmentMap = new Map<string, Set<string>>()
    for (const assignment of existingAssignments) {
      const resourceId = assignment.resource?.id
      const tagId = assignment.tag?.id
      if (!resourceId || !tagId) continue
      const set = assignmentMap.get(resourceId) ?? new Set<string>()
      set.add(tagId)
      assignmentMap.set(resourceId, set)
    }

    for (const seed of RESOURCE_SEEDS) {
      const resource = resourceByKey.get(seed.key)
      if (!resource) continue
      const existing = assignmentMap.get(resource.id) ?? new Set<string>()
      for (const tagKey of seed.tagKeys) {
        const tag = tagByKey.get(tagKey)
        if (!tag || existing.has(tag.id)) continue
        const assignment = em.create(ResourcesResourceTagAssignment, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          resource: em.getReference(ResourcesResource, resource.id),
          tag: em.getReference(ResourcesResourceTag, tag.id),
          createdAt: now,
          updatedAt: now,
        })
        em.persist(assignment)
        existing.add(tag.id)
      }
      assignmentMap.set(resource.id, existing)
    }
    await em.flush()
  }
}
