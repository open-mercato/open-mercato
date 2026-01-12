import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { BOOKING_CAPACITY_UNIT_DEFAULTS, BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from './capacityUnits'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { CustomFieldEntityConfig, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import {
  BookingResource,
  BookingResourceTag,
  BookingResourceTagAssignment,
  BookingResourceType,
  BookingService,
  BookingTeam,
  BookingTeamMember,
  BookingTeamRole,
  BookingAvailabilityRule,
  BookingAvailabilityRuleSet,
  type BookingResourceRequirement,
  type BookingResourceTypeRequirement,
} from '../data/entities'
import { E } from '#generated/entities.ids.generated'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  BOOKING_RESOURCE_CUSTOM_FIELD_SETS,
  BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR,
  BOOKING_RESOURCE_FIELDSETS,
  BOOKING_RESOURCE_FIELDSET_HAIR_KIT,
  BOOKING_RESOURCE_FIELDSET_LAPTOP,
  BOOKING_RESOURCE_FIELDSET_ROOM,
  BOOKING_RESOURCE_FIELDSET_SEAT,
  resolveBookingResourceFieldsetCode,
} from './resourceCustomFields'

export type BookingSeedScope = { tenantId: string; organizationId: string }

type WorkingHours = { startHour: number; startMinute: number; endHour: number; endMinute: number }

const DEFAULT_AVAILABILITY_RULESET_TIMEZONE = 'UTC'
const DEFAULT_WORKING_HOURS: WorkingHours = { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }
const WEEKEND_WORKING_HOURS: WorkingHours = { startHour: 10, startMinute: 0, endHour: 14, endMinute: 0 }

const AVAILABILITY_RULESET_SEEDS = [
  {
    name: 'Normal working hours',
    description: 'Standard working hours: Monday-Friday, 09:00-17:00.',
    timezone: DEFAULT_AVAILABILITY_RULESET_TIMEZONE,
    weekdays: [1, 2, 3, 4, 5],
    hours: DEFAULT_WORKING_HOURS,
  },
  {
    name: 'Weekends',
    description: 'Weekend availability: Saturday-Sunday, 10:00-14:00.',
    timezone: DEFAULT_AVAILABILITY_RULESET_TIMEZONE,
    weekdays: [0, 6],
    hours: WEEKEND_WORKING_HOURS,
  },
] as const

async function ensureResourceFieldsetConfig(em: EntityManager, scope: BookingSeedScope) {
  const now = new Date()
  let config = await em.findOne(CustomFieldEntityConfig, {
    entityId: E.booking.booking_resource,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!config) {
    config = em.create(CustomFieldEntityConfig, {
      entityId: E.booking.booking_resource,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }
  config.configJson = {
    fieldsets: BOOKING_RESOURCE_FIELDSETS,
    singleFieldsetPerRecord: true,
  }
  config.isActive = true
  config.updatedAt = now
  em.persist(config)
}

async function ensureResourceCustomFields(em: EntityManager, scope: BookingSeedScope) {
  await ensureResourceFieldsetConfig(em, scope)
  await ensureCustomFieldDefinitions(em, BOOKING_RESOURCE_CUSTOM_FIELD_SETS, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.flush()
}

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

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildAvailabilityRrule(start: Date, end: Date, weekdayCode: string): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  const rule = `FREQ=WEEKLY;BYDAY=${weekdayCode}`
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:${rule}`
}

function weekdayCodeForIndex(index: number): string {
  const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  return codes[index] ?? 'MO'
}

function buildWeeklyRuleForWeekday(weekdayIndex: number, hours: WorkingHours): string {
  const baseMonday = Date.UTC(2025, 0, 6, 0, 0, 0)
  const offsetDays = (weekdayIndex - 1 + 7) % 7
  const start = new Date(baseMonday + offsetDays * 24 * 60 * 60 * 1000)
  start.setUTCHours(hours.startHour, hours.startMinute, 0, 0)
  const end = new Date(baseMonday + offsetDays * 24 * 60 * 60 * 1000)
  end.setUTCHours(hours.endHour, hours.endMinute, 0, 0)
  return buildAvailabilityRrule(start, end, weekdayCodeForIndex(weekdayIndex))
}

export async function seedBookingAvailabilityRuleSetDefaults(
  em: EntityManager,
  scope: BookingSeedScope,
) {
  const now = new Date()
  for (const seed of AVAILABILITY_RULESET_SEEDS) {
    const existing = await findWithDecryption(
      em,
      BookingAvailabilityRuleSet,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: seed.name,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    const ruleSet = existing[0] ?? em.create(BookingAvailabilityRuleSet, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      description: seed.description,
      timezone: seed.timezone,
      createdAt: now,
      updatedAt: now,
    })
    if (!existing[0]) {
      em.persist(ruleSet)
      await em.flush()
    }

    const rules = await findWithDecryption(
      em,
      BookingAvailabilityRule,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        subjectType: 'ruleset',
        subjectId: ruleSet.id,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    const existingByRrule = new Set(rules.map((rule) => rule.rrule))
    for (const weekday of seed.weekdays) {
      const rrule = buildWeeklyRuleForWeekday(weekday, seed.hours)
      if (existingByRrule.has(rrule)) continue
      const rule = em.create(BookingAvailabilityRule, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        subjectType: 'ruleset',
        subjectId: ruleSet.id,
        timezone: seed.timezone,
        rrule,
        exdates: [],
        kind: 'availability',
        note: null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(rule)
    }
    await em.flush()
  }
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

type BookingTeamRoleSeed = {
  key: string
  name: string
  teamKey?: string | null
  description?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type BookingTeamMemberSeed = {
  key: string
  displayName: string
  teamKey?: string | null
  description?: string | null
  roleKeys: string[]
  tags?: string[]
  userIndex?: number
  customFields?: Record<string, string | number | boolean | null>
}

type BookingTeamSeed = {
  key: string
  name: string
  description?: string | null
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
    case BOOKING_RESOURCE_FIELDSET_ROOM:
      return {
        room_floor: '1',
        room_zone: 'North Wing',
        room_projector: true,
        room_whiteboard: true,
        room_access_notes: 'Keycard access required after 6pm.',
      }
    case BOOKING_RESOURCE_FIELDSET_LAPTOP: {
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
    case BOOKING_RESOURCE_FIELDSET_SEAT:
      return {
        seat_style: 'standard',
        seat_heated: false,
        seat_positioning: 'Adjust headrest for extended sessions.',
      }
    case BOOKING_RESOURCE_FIELDSET_HAIR_KIT:
      return {
        kit_inventory: 'Shears, clippers, comb set, cape, spray bottle.',
        kit_restock_cycle: 'Monthly',
        kit_maintenance: 'Replace clipper blades every quarter.',
      }
    case BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR:
      return {
        chair_model: 'DX-300',
        chair_ultrasonic: true,
        chair_last_disinfected: '2025-01-01',
        chair_inspection_notes: 'Monthly inspection scheduled.',
      }
    default:
      return {}
  }
}

async function fillMissingResourceCustomFields(
  em: EntityManager,
  scope: BookingSeedScope,
  resource: BookingResource,
  customValues: Record<string, string | number | boolean | null>,
) {
  const keys = Object.keys(customValues)
  if (!keys.length) return
  const existingValues = await em.find(CustomFieldValue, {
    entityId: E.booking.booking_resource,
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
    entityId: E.booking.booking_resource,
    recordId: resource.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    values: missingValues,
  })
}

const RESOURCE_TYPE_SEEDS: BookingResourceTypeSeed[] = [
  {
    key: 'room',
    name: 'Consultation room',
    description: 'Private room for client consultations.',
    appearanceIcon: 'lucide:building',
    appearanceColor: '#2563eb',
  },
  {
    key: 'laptop',
    name: 'Engineering laptop',
    description: 'Portable computer for software teams.',
    appearanceIcon: 'lucide:cpu',
    appearanceColor: '#0ea5e9',
  },
  {
    key: 'client_seat',
    name: 'Salon seat',
    description: 'Seat for salon services.',
    appearanceIcon: 'lucide:users',
    appearanceColor: '#16a34a',
  },
  {
    key: 'hair_kit',
    name: 'Hair kit',
    description: 'Tools and supplies for hair services.',
    appearanceIcon: 'lucide:wand',
    appearanceColor: '#ea580c',
  },
  {
    key: 'dental_chair',
    name: 'Dental chair',
    description: 'Chair for dental treatments.',
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
  { key: 'dental-room-1', name: 'Dental Room 1', typeKey: 'room', tagKeys: ['room', 'dental'] },
  { key: 'dental-room-2', name: 'Dental Room 2', typeKey: 'room', tagKeys: ['room', 'dental'] },
  { key: 'dental-chair-1', name: 'Dental Chair 1', typeKey: 'dental_chair', tagKeys: ['seat', 'dental'] },
  { key: 'dental-chair-2', name: 'Dental Chair 2', typeKey: 'dental_chair', tagKeys: ['seat', 'dental'] },
  { key: 'software-room-a', name: 'Software Room A', typeKey: 'room', tagKeys: ['room', 'tech'] },
  { key: 'engineer-laptop-1', name: 'Engineer Laptop 1', typeKey: 'laptop', tagKeys: ['tech', 'equipment'] },
  { key: 'engineer-laptop-2', name: 'Engineer Laptop 2', typeKey: 'laptop', tagKeys: ['tech', 'equipment'] },
  { key: 'salon-seat-1', name: 'Salon Seat 1', typeKey: 'client_seat', tagKeys: ['seat', 'hair'] },
  { key: 'salon-seat-2', name: 'Salon Seat 2', typeKey: 'client_seat', tagKeys: ['seat', 'hair'] },
  { key: 'hair-kit-a', name: 'Hair Kit A', typeKey: 'hair_kit', tagKeys: ['hair', 'equipment'] },
  { key: 'hair-kit-b', name: 'Hair Kit B', typeKey: 'hair_kit', tagKeys: ['hair', 'equipment'] },
]

const SERVICE_SEEDS: BookingServiceSeed[] = [
  {
    key: 'software-consultation',
    name: 'Software Consultation',
    description: 'Advisory session for software teams.',
    durationMinutes: 60,
    capacityModel: 'one_to_one',
    maxAttendees: 1,
    tagLabels: ['software', 'consulting'],
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

const TEAM_ROLE_SEEDS: BookingTeamRoleSeed[] = [
  {
    key: 'dentist',
    name: 'Dentist',
    teamKey: 'dental',
    description: 'Primary dental care provider.',
    appearanceIcon: 'lucide:stethoscope',
    appearanceColor: '#0f766e',
  },
  {
    key: 'dental_assistant',
    name: 'Dental assistant',
    teamKey: 'dental',
    description: 'Supports dental treatments and room prep.',
    appearanceIcon: 'lucide:clipboard',
    appearanceColor: '#2563eb',
  },
  {
    key: 'software_engineer',
    name: 'Software engineer',
    teamKey: 'software',
    description: 'Leads technical sessions and delivery.',
    appearanceIcon: 'lucide:code',
    appearanceColor: '#0ea5e9',
  },
  {
    key: 'product_lead',
    name: 'Product lead',
    teamKey: 'software',
    description: 'Coordinates software delivery and client needs.',
    appearanceIcon: 'lucide:layout-grid',
    appearanceColor: '#14b8a6',
  },
  {
    key: 'hair_stylist',
    name: 'Hair stylist',
    teamKey: 'hair',
    description: 'Delivers salon services and styling.',
    appearanceIcon: 'lucide:scissors',
    appearanceColor: '#ea580c',
  },
  {
    key: 'color_specialist',
    name: 'Color specialist',
    teamKey: 'hair',
    description: 'Handles color and treatment services.',
    appearanceIcon: 'lucide:palette',
    appearanceColor: '#b45309',
  },
]

const TEAM_SEEDS: BookingTeamSeed[] = [
  {
    key: 'dental',
    name: 'Dental clinic',
    description: 'Dental care providers and assistants.',
  },
  {
    key: 'software',
    name: 'Software studio',
    description: 'Software delivery and consulting team.',
  },
  {
    key: 'hair',
    name: 'Hair salon',
    description: 'Salon stylists and color specialists.',
  },
]

const TEAM_MEMBER_SEEDS: BookingTeamMemberSeed[] = [
  {
    key: 'dr_aria_santos',
    displayName: 'Dr. Aria Santos',
    teamKey: 'dental',
    description: 'Leads dental consults and treatment plans.',
    roleKeys: ['dentist'],
    tags: ['dental', 'lead'],
    userIndex: 0,
    customFields: { years_of_experience: 12, hourly_rate: 180, currency_code: 'USD' },
  },
  {
    key: 'mia_keller',
    displayName: 'Mia Keller',
    teamKey: 'dental',
    description: 'Assists with dental prep and hygiene.',
    roleKeys: ['dental_assistant'],
    tags: ['dental', 'support'],
    userIndex: 1,
    customFields: { years_of_experience: 6, hourly_rate: 95, currency_code: 'USD' },
  },
  {
    key: 'rohan_desai',
    displayName: 'Rohan Desai',
    teamKey: 'software',
    description: 'Leads architecture workshops and delivery.',
    roleKeys: ['software_engineer'],
    tags: ['software', 'lead'],
    userIndex: 2,
    customFields: { years_of_experience: 9, hourly_rate: 160, currency_code: 'USD' },
  },
  {
    key: 'claire_hudson',
    displayName: 'Claire Hudson',
    teamKey: 'software',
    description: 'Coordinates product scope and client needs.',
    roleKeys: ['product_lead'],
    tags: ['software', 'product'],
    customFields: { years_of_experience: 7, hourly_rate: 140, currency_code: 'USD' },
  },
  {
    key: 'kiara_jones',
    displayName: 'Kiara Jones',
    teamKey: 'hair',
    description: 'Specializes in modern cuts and styling.',
    roleKeys: ['hair_stylist'],
    tags: ['hair', 'stylist'],
    customFields: { years_of_experience: 8, hourly_rate: 110, currency_code: 'USD' },
  },
  {
    key: 'noah_bennett',
    displayName: 'Noah Bennett',
    teamKey: 'hair',
    description: 'Focuses on color treatments and care.',
    roleKeys: ['color_specialist'],
    tags: ['hair', 'color'],
    customFields: { years_of_experience: 5, hourly_rate: 100, currency_code: 'USD' },
  },
]

async function fillMissingTeamMemberCustomFields(
  em: EntityManager,
  scope: BookingSeedScope,
  member: BookingTeamMember,
  customValues: Record<string, string | number | boolean | null>,
) {
  const keys = Object.keys(customValues)
  if (!keys.length) return
  const existingValues = await em.find(CustomFieldValue, {
    entityId: E.booking.booking_team_member,
    recordId: member.id,
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
    entityId: E.booking.booking_team_member,
    recordId: member.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    values: missingValues,
  })
}

async function seedBookingTeamExamples(
  em: EntityManager,
  scope: BookingSeedScope,
) {
  const now = new Date()
  const teamNames = TEAM_SEEDS.map((seed) => seed.name)
  const existingTeams = await findWithDecryption(
    em,
    BookingTeam,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: { $in: teamNames },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const teamByName = new Map(existingTeams.map((team) => [team.name.toLowerCase(), team]))
  const teamByKey = new Map<string, BookingTeam>()
  for (const seed of TEAM_SEEDS) {
    const existing = teamByName.get(seed.name.toLowerCase())
    if (existing) {
      let updated = false
      if (!existing.description && seed.description) {
        existing.description = seed.description
        updated = true
      }
      if (updated) {
        existing.updatedAt = now
        em.persist(existing)
      }
      teamByKey.set(seed.key, existing)
      continue
    }
    const record = em.create(BookingTeam, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      description: seed.description ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    teamByKey.set(seed.key, record)
  }
  await em.flush()

  const roleNames = TEAM_ROLE_SEEDS.map((seed) => seed.name)
  const existingRoles = await findWithDecryption(
    em,
    BookingTeamRole,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: { $in: roleNames },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const roleByName = new Map(existingRoles.map((role) => [role.name.toLowerCase(), role]))
  const roleByKey = new Map<string, BookingTeamRole>()
  for (const seed of TEAM_ROLE_SEEDS) {
    const existing = roleByName.get(seed.name.toLowerCase())
    const teamId = seed.teamKey ? teamByKey.get(seed.teamKey)?.id ?? null : null
    if (existing) {
      let updated = false
      if (!existing.teamId && teamId) {
        existing.teamId = teamId
        updated = true
      }
      if (!existing.appearanceIcon && seed.appearanceIcon) {
        existing.appearanceIcon = seed.appearanceIcon
        updated = true
      }
      if (!existing.appearanceColor && seed.appearanceColor) {
        existing.appearanceColor = seed.appearanceColor
        updated = true
      }
      if (!existing.description && seed.description) {
        existing.description = seed.description
        updated = true
      }
      if (updated) {
        existing.updatedAt = now
        em.persist(existing)
      }
      roleByKey.set(seed.key, existing)
      continue
    }
    const record = em.create(BookingTeamRole, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      teamId,
      name: seed.name,
      description: seed.description ?? null,
      appearanceIcon: seed.appearanceIcon ?? null,
      appearanceColor: seed.appearanceColor ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    roleByKey.set(seed.key, record)
  }
  await em.flush()

  const users = await findWithDecryption(
    em,
    User,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const sortedUsers = [...users].sort((a, b) => {
    const left = a.email ?? ''
    const right = b.email ?? ''
    return left.localeCompare(right)
  })

  const memberNames = TEAM_MEMBER_SEEDS.map((seed) => seed.displayName)
  const existingMembers = await findWithDecryption(
    em,
    BookingTeamMember,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      displayName: { $in: memberNames },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const memberByName = new Map(existingMembers.map((member) => [member.displayName.toLowerCase(), member]))

  for (const seed of TEAM_MEMBER_SEEDS) {
    const roleIds = seed.roleKeys
      .map((key) => roleByKey.get(key)?.id ?? null)
      .filter((id): id is string => typeof id === 'string')
    const userId = typeof seed.userIndex === 'number'
      ? sortedUsers[seed.userIndex]?.id ?? null
      : null
    const teamId = seed.teamKey ? teamByKey.get(seed.teamKey)?.id ?? null : null
    const existing = memberByName.get(seed.displayName.toLowerCase())
    if (existing) {
      let updated = false
      if (!existing.teamId && teamId) {
        existing.teamId = teamId
        updated = true
      }
      if (!existing.description && seed.description) {
        existing.description = seed.description
        updated = true
      }
      if ((!existing.roleIds || existing.roleIds.length === 0) && roleIds.length) {
        existing.roleIds = roleIds
        updated = true
      }
      const seedTags = seed.tags ?? []
      if ((!existing.tags || existing.tags.length === 0) && seedTags.length) {
        existing.tags = seedTags
        updated = true
      }
      if (!existing.userId && userId) {
        existing.userId = userId
        updated = true
      }
      if (updated) {
        existing.updatedAt = now
        em.persist(existing)
      }
      continue
    }
    const record = em.create(BookingTeamMember, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      teamId,
      displayName: seed.displayName,
      description: seed.description ?? null,
      userId,
      roleIds,
      tags: seed.tags ?? [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
  }
  await em.flush()

  const memberSeedsByName = new Map(TEAM_MEMBER_SEEDS.map((seed) => [seed.displayName.toLowerCase(), seed]))
  const membersInScope = await findWithDecryption(
    em,
    BookingTeamMember,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  for (const member of membersInScope) {
    const seed = member.displayName ? memberSeedsByName.get(member.displayName.toLowerCase()) : null
    if (!seed?.customFields) continue
    await fillMissingTeamMemberCustomFields(em, scope, member, seed.customFields)
  }
}

export async function seedBookingResourceExamples(
  em: EntityManager,
  scope: BookingSeedScope,
) {
  const now = new Date()
  await ensureResourceCustomFields(em, scope)
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

  const allTypes = await findWithDecryption(
    em,
    BookingResourceType,
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

  const resourcesInScope = await findWithDecryption(
    em,
    BookingResource,
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
    const fieldsetCode = resolveBookingResourceFieldsetCode(typeName ?? resourceName)
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
      requiredRoles: [],
      requiredMembers: [],
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

  await seedBookingTeamExamples(em, scope)
}
