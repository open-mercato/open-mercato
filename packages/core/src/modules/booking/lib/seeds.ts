import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { BOOKING_CAPACITY_UNIT_DEFAULTS, BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from './capacityUnits'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  BookingResource,
  BookingResourceTag,
  BookingResourceTagAssignment,
  BookingResourceType,
  BookingService,
  type BookingResourceRequirement,
  type BookingResourceTypeRequirement,
} from '../data/entities'

export type BookingSeedScope = { tenantId: string; organizationId: string }

export async function seedBookingCapacityUnits(
  em: EntityManager,
  scope: BookingSeedScope,
) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: BOOKING_CAPACITY_UNIT_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: BOOKING_CAPACITY_UNIT_DICTIONARY_KEY,
      name: 'Booking capacity units',
      description: 'Units for booking resource capacity (spots, units, quantity, etc.).',
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
  for (const unit of BOOKING_CAPACITY_UNIT_DEFAULTS) {
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

type BookingResourceTypeSeed = {
  key: string
  name: string
  description?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type BookingResourceTagSeed = {
  key: string
  slug: string
  label: string
  color?: string | null
  description?: string | null
}

type BookingResourceSeed = {
  key: string
  name: string
  typeKey?: string | null
  tagKeys: string[]
}

type BookingServiceSeed = {
  key: string
  name: string
  description?: string | null
  durationMinutes: number
  capacityModel: 'one_to_one' | 'one_to_many' | 'many_to_many'
  maxAttendees?: number | null
  tagLabels: string[]
  requiredResourceTypes: Array<{ typeKey: string; qty: number }>
  requiredResources?: BookingResourceRequirement[]
}

const RESOURCE_TYPE_SEEDS: BookingResourceTypeSeed[] = [
  {
    key: 'room',
    name: 'Room',
    description: 'Private room for appointments.',
    appearanceIcon: 'lucide:building',
    appearanceColor: '#2563eb',
  },
  {
    key: 'laptop',
    name: 'Laptop',
    description: 'Portable computer for sessions.',
    appearanceIcon: 'lucide:cpu',
    appearanceColor: '#0ea5e9',
  },
  {
    key: 'client_seat',
    name: 'Client seat',
    description: 'Seat for client services.',
    appearanceIcon: 'lucide:users',
    appearanceColor: '#16a34a',
  },
  {
    key: 'hair_kit',
    name: 'Hairdressing kit',
    description: 'Tools and supplies for hairdressing.',
    appearanceIcon: 'lucide:wand',
    appearanceColor: '#ea580c',
  },
  {
    key: 'dental_chair',
    name: 'Dental chair',
    description: 'Patient dental chair.',
    appearanceIcon: 'lucide:heart',
    appearanceColor: '#0f766e',
  },
]

const TAG_SEEDS: BookingResourceTagSeed[] = [
  { key: 'room', slug: 'room', label: 'Room', color: '#1d4ed8' },
  { key: 'tech', slug: 'tech', label: 'Tech', color: '#0f766e' },
  { key: 'seat', slug: 'seat', label: 'Seat', color: '#374151' },
  { key: 'hair', slug: 'hair', label: 'Hairdressing', color: '#b91c1c' },
  { key: 'dental', slug: 'dental', label: 'Dental', color: '#0369a1' },
  { key: 'equipment', slug: 'equipment', label: 'Equipment', color: '#6b21a8' },
]

const RESOURCE_SEEDS: BookingResourceSeed[] = [
  { key: 'therapy-room-1', name: 'Therapy Room 1', typeKey: 'room', tagKeys: ['room'] },
  { key: 'therapy-room-2', name: 'Therapy Room 2', typeKey: 'room', tagKeys: ['room'] },
  { key: 'consult-room-a', name: 'Consultation Room A', typeKey: 'room', tagKeys: ['room'] },
  { key: 'laptop-1', name: 'Laptop 1', typeKey: 'laptop', tagKeys: ['tech', 'equipment'] },
  { key: 'hair-station-1', name: 'Hair Station 1', typeKey: 'client_seat', tagKeys: ['seat', 'hair'] },
  { key: 'hair-station-2', name: 'Hair Station 2', typeKey: 'client_seat', tagKeys: ['seat', 'hair'] },
  { key: 'hair-kit-a', name: 'Hair Kit A', typeKey: 'hair_kit', tagKeys: ['hair', 'equipment'] },
  { key: 'dental-chair-1', name: 'Dental Chair 1', typeKey: 'dental_chair', tagKeys: ['seat', 'dental'] },
  { key: 'dental-chair-2', name: 'Dental Chair 2', typeKey: 'dental_chair', tagKeys: ['seat', 'dental'] },
]

const SERVICE_SEEDS: BookingServiceSeed[] = [
  {
    key: 'speech-therapy',
    name: 'Speech Therapy Session',
    description: 'Private speech therapy session.',
    durationMinutes: 45,
    capacityModel: 'one_to_one',
    maxAttendees: 1,
    tagLabels: ['therapy', 'speech'],
    requiredResourceTypes: [
      { typeKey: 'room', qty: 1 },
      { typeKey: 'laptop', qty: 1 },
    ],
  },
  {
    key: 'haircut',
    name: 'Haircut',
    description: 'Standard haircut appointment.',
    durationMinutes: 60,
    capacityModel: 'one_to_one',
    maxAttendees: 1,
    tagLabels: ['hair'],
    requiredResourceTypes: [
      { typeKey: 'client_seat', qty: 1 },
      { typeKey: 'hair_kit', qty: 1 },
    ],
  },
  {
    key: 'dental-checkup',
    name: 'Dental Checkup',
    description: 'Routine dental checkup.',
    durationMinutes: 30,
    capacityModel: 'one_to_one',
    maxAttendees: 1,
    tagLabels: ['dental'],
    requiredResourceTypes: [
      { typeKey: 'dental_chair', qty: 1 },
      { typeKey: 'room', qty: 1 },
    ],
  },
]

export async function seedBookingResourceExamples(
  em: EntityManager,
  scope: BookingSeedScope,
) {
  const now = new Date()
  const typeNames = RESOURCE_TYPE_SEEDS.map((seed) => seed.name)
  const existingTypes = await findWithDecryption(
    em,
    BookingResourceType,
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
  const typeByKey = new Map<string, BookingResourceType>()
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
    const record = em.create(BookingResourceType, {
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

  const tagSlugs = TAG_SEEDS.map((seed) => seed.slug)
  const existingTags = await findWithDecryption(
    em,
    BookingResourceTag,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      slug: { $in: tagSlugs },
    },
    undefined,
    scope,
  )
  const tagBySlug = new Map(existingTags.map((tag) => [tag.slug.toLowerCase(), tag]))
  const tagByKey = new Map<string, BookingResourceTag>()
  for (const seed of TAG_SEEDS) {
    const existing = tagBySlug.get(seed.slug.toLowerCase())
    if (existing) {
      tagByKey.set(seed.key, existing)
      continue
    }
    const tag = em.create(BookingResourceTag, {
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
    BookingResource,
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
  const resourceByKey = new Map<string, BookingResource>()
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
    const resource = em.create(BookingResource, {
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

  const resourceList = Array.from(resourceByKey.values())
  if (resourceList.length > 0) {
    const existingAssignments = await findWithDecryption(
      em,
      BookingResourceTagAssignment,
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
        const assignment = em.create(BookingResourceTagAssignment, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          resource: em.getReference(BookingResource, resource.id),
          tag: em.getReference(BookingResourceTag, tag.id),
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

  const serviceNames = SERVICE_SEEDS.map((seed) => seed.name)
  const existingServices = await findWithDecryption(
    em,
    BookingService,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: { $in: serviceNames },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const serviceByName = new Map(existingServices.map((service) => [service.name.toLowerCase(), service]))
  for (const seed of SERVICE_SEEDS) {
    if (serviceByName.has(seed.name.toLowerCase())) continue
    const requiredResourceTypes: BookingResourceTypeRequirement[] = seed.requiredResourceTypes
      .map((entry) => {
        const type = typeByKey.get(entry.typeKey)
        if (!type) return null
        return { resourceTypeId: type.id, qty: entry.qty }
      })
      .filter((entry): entry is BookingResourceTypeRequirement => !!entry)
    const service = em.create(BookingService, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      description: seed.description ?? null,
      durationMinutes: seed.durationMinutes,
      capacityModel: seed.capacityModel,
      maxAttendees: seed.maxAttendees ?? null,
      requiredResources: seed.requiredResources ?? [],
      requiredResourceTypes,
      tags: seed.tagLabels,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(service)
  }
  await em.flush()
}
