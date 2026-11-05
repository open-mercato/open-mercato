import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue, sanitizeDictionaryColor, sanitizeDictionaryIcon } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { CustomFieldEntityConfig, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  StaffTeam,
  StaffTeamMember,
  StaffTeamMemberActivity,
  StaffTeamMemberAddress,
  StaffTeamMemberComment,
  StaffTeamRole,
} from '../data/entities'
import { E } from '#generated/entities.ids.generated'
import {
  STAFF_TEAM_MEMBER_ACTIVITY_CUSTOM_FIELD_SETS,
  STAFF_TEAM_MEMBER_CUSTOM_FIELD_SETS,
  STAFF_TEAM_MEMBER_FIELDSETS,
} from './customFields'

export type StaffSeedScope = { tenantId: string; organizationId: string }

type DictionarySeedEntry = {
  value: string
  label?: string
  color?: string | null
  icon?: string | null
}

type StaffTeamRoleSeed = {
  key: string
  name: string
  teamKey?: string | null
  description?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type StaffTeamMemberSeed = {
  key: string
  displayName: string
  teamKey?: string | null
  description?: string | null
  roleKeys: string[]
  tags?: string[]
  userIndex?: number
  customFields?: Record<string, string | number | boolean | null | string[]>
}

type StaffTeamSeed = {
  key: string
  name: string
  description?: string | null
}

type StaffTeamMemberNoteSeed = {
  memberKey: string
  body: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
  authorUserIndex?: number
  daysAgo?: number
}

type StaffTeamMemberActivitySeed = {
  memberKey: string
  activityType: string
  subject?: string | null
  body?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
  authorUserIndex?: number
  daysAgo?: number
  customFields?: Record<string, string | number | boolean | null>
}

type StaffTeamMemberAddressSeed = {
  memberKey: string
  name?: string | null
  purpose?: string | null
  companyName?: string | null
  addressLine1: string
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  isPrimary?: boolean
}

const TEAM_ROLE_SEEDS: StaffTeamRoleSeed[] = [
  {
    key: 'backend_engineer',
    name: 'Backend engineer',
    teamKey: 'engineering',
    description: 'Builds core services, APIs, and integrations.',
    appearanceIcon: 'lucide:server',
    appearanceColor: '#2563eb',
  },
  {
    key: 'frontend_engineer',
    name: 'Frontend engineer',
    teamKey: 'engineering',
    description: 'Owns UI delivery and design system updates.',
    appearanceIcon: 'lucide:monitor',
    appearanceColor: '#0ea5e9',
  },
  {
    key: 'product_manager',
    name: 'Product manager',
    teamKey: 'product',
    description: 'Drives product discovery and roadmap delivery.',
    appearanceIcon: 'lucide:layout-grid',
    appearanceColor: '#14b8a6',
  },
  {
    key: 'ux_designer',
    name: 'UX designer',
    teamKey: 'product',
    description: 'Designs user flows and interface patterns.',
    appearanceIcon: 'lucide:pen-tool',
    appearanceColor: '#f97316',
  },
  {
    key: 'devops_engineer',
    name: 'DevOps engineer',
    teamKey: 'operations',
    description: 'Maintains infrastructure and delivery tooling.',
    appearanceIcon: 'lucide:cloud',
    appearanceColor: '#7c3aed',
  },
]

const TEAM_SEEDS: StaffTeamSeed[] = [
  {
    key: 'engineering',
    name: 'Engineering',
    description: 'Backend and frontend delivery squad.',
  },
  {
    key: 'product',
    name: 'Product',
    description: 'Product management and design leadership.',
  },
  {
    key: 'operations',
    name: 'Operations',
    description: 'Infrastructure, IT, and internal tooling.',
  },
]

const TEAM_MEMBER_SEEDS: StaffTeamMemberSeed[] = [
  {
    key: 'alex_chen',
    displayName: 'Alex Chen',
    teamKey: 'engineering',
    description: 'Backend lead focused on platform reliability.',
    roleKeys: ['backend_engineer'],
    tags: ['backend', 'platform'],
    userIndex: 0,
    customFields: {
      years_of_experience: 9,
      hourly_rate: 165,
      currency_code: 'USD',
      employment_date: '2021-03-15',
      employment_type: 'full_time',
      onboarded: true,
      bio: 'Platform-focused engineer who owns core service reliability.',
      work_mode: 'hybrid',
      focus_areas: ['APIs', 'observability', 'infra'],
    },
  },
  {
    key: 'priya_nair',
    displayName: 'Priya Nair',
    teamKey: 'engineering',
    description: 'Frontend specialist pairing with design systems.',
    roleKeys: ['frontend_engineer'],
    tags: ['frontend', 'design-system'],
    userIndex: 1,
    customFields: {
      years_of_experience: 7,
      hourly_rate: 140,
      currency_code: 'USD',
      employment_date: '2020-11-02',
      employment_type: 'full_time',
      onboarded: true,
      bio: 'Partners closely with design to ship crisp UI experiences.',
      work_mode: 'remote',
      focus_areas: ['design systems', 'accessibility'],
    },
  },
  {
    key: 'marta_lopez',
    displayName: 'Marta Lopez',
    teamKey: 'product',
    description: 'Keeps roadmap aligned with customer outcomes.',
    roleKeys: ['product_manager'],
    tags: ['product', 'strategy'],
    userIndex: 2,
    customFields: {
      years_of_experience: 10,
      hourly_rate: 155,
      currency_code: 'EUR',
      employment_date: '2019-06-10',
      employment_type: 'full_time',
      onboarded: true,
      bio: 'Translates customer feedback into clear product priorities.',
      work_mode: 'hybrid',
      focus_areas: ['roadmap', 'customer discovery'],
    },
  },
  {
    key: 'samir_haddad',
    displayName: 'Samir Haddad',
    teamKey: 'product',
    description: 'Designs workflows and UX patterns for admins.',
    roleKeys: ['ux_designer'],
    tags: ['design', 'ux'],
    customFields: {
      years_of_experience: 8,
      hourly_rate: 130,
      currency_code: 'GBP',
      employment_date: '2022-02-01',
      employment_type: 'contract',
      onboarded: true,
      bio: 'Turns complex workflows into approachable UI patterns.',
      work_mode: 'remote',
      focus_areas: ['flows', 'prototyping'],
    },
  },
  {
    key: 'jordan_kim',
    displayName: 'Jordan Kim',
    teamKey: 'operations',
    description: 'Keeps environments stable and deployments smooth.',
    roleKeys: ['devops_engineer'],
    tags: ['devops', 'infra'],
    customFields: {
      years_of_experience: 6,
      hourly_rate: 150,
      currency_code: 'USD',
      employment_date: '2023-05-08',
      employment_type: 'full_time',
      onboarded: false,
      bio: 'Owns CI/CD pipelines and monitoring dashboards.',
      work_mode: 'onsite',
      focus_areas: ['ci/cd', 'security'],
    },
  },
]

const TEAM_MEMBER_NOTE_SEEDS: StaffTeamMemberNoteSeed[] = [
  {
    memberKey: 'alex_chen',
    body: 'Reviewed API latency metrics and flagged two services for cache tuning.',
    appearanceIcon: 'lucide:message-circle',
    appearanceColor: '#2563eb',
    daysAgo: 14,
  },
  {
    memberKey: 'priya_nair',
    body: 'Partnered with design to refresh the admin UI spacing scale.',
    appearanceIcon: 'lucide:pen-tool',
    appearanceColor: '#0ea5e9',
    daysAgo: 9,
  },
  {
    memberKey: 'marta_lopez',
    body: 'Prepared Q2 roadmap review and surfaced three customer retention risks.',
    appearanceIcon: 'lucide:clipboard-list',
    appearanceColor: '#14b8a6',
    daysAgo: 21,
  },
  {
    memberKey: 'samir_haddad',
    body: 'Shared updated journey map for onboarding and handoff to support.',
    appearanceIcon: 'lucide:map',
    appearanceColor: '#f97316',
    daysAgo: 6,
  },
  {
    memberKey: 'jordan_kim',
    body: 'Reviewed incident playbooks and scheduled a backup drill.',
    appearanceIcon: 'lucide:shield-check',
    appearanceColor: '#7c3aed',
    daysAgo: 3,
  },
]

const TEAM_MEMBER_ACTIVITY_SEEDS: StaffTeamMemberActivitySeed[] = [
  {
    memberKey: 'alex_chen',
    activityType: 'Performance review',
    subject: 'Q1 performance review complete',
    body: 'Aligned on scaling priorities for platform observability.',
    appearanceIcon: 'lucide:clipboard-check',
    appearanceColor: '#2563eb',
    daysAgo: 30,
    customFields: {
      activity_outcome: 'completed',
      follow_up_owner: 'Alex Chen',
      requires_follow_up: false,
    },
  },
  {
    memberKey: 'priya_nair',
    activityType: 'Training',
    subject: 'Completed accessibility refresher',
    body: 'Focused on color contrast and keyboard navigation.',
    appearanceIcon: 'lucide:graduation-cap',
    appearanceColor: '#0ea5e9',
    daysAgo: 18,
    customFields: {
      activity_outcome: 'completed',
      follow_up_owner: 'Priya Nair',
      requires_follow_up: false,
    },
  },
  {
    memberKey: 'marta_lopez',
    activityType: 'Certification',
    subject: 'Product strategy certification',
    body: 'Covered outcome-driven roadmapping practices.',
    appearanceIcon: 'lucide:badge-check',
    appearanceColor: '#16a34a',
    daysAgo: 40,
    customFields: {
      activity_outcome: 'completed',
      follow_up_owner: 'Marta Lopez',
      requires_follow_up: false,
    },
  },
  {
    memberKey: 'samir_haddad',
    activityType: 'Onboarding',
    subject: 'New design tooling walkthrough',
    body: 'Introduced shared component library workflows.',
    appearanceIcon: 'lucide:user-plus',
    appearanceColor: '#f97316',
    daysAgo: 12,
    customFields: {
      activity_outcome: 'completed',
      follow_up_owner: 'Samir Haddad',
      requires_follow_up: false,
    },
  },
  {
    memberKey: 'jordan_kim',
    activityType: 'Shift change',
    subject: 'On-call rotation update',
    body: 'Moved primary on-call to midweek coverage.',
    appearanceIcon: 'lucide:clock-3',
    appearanceColor: '#7c3aed',
    daysAgo: 7,
    customFields: {
      activity_outcome: 'rescheduled',
      follow_up_owner: 'Jordan Kim',
      requires_follow_up: true,
    },
  },
]

const TEAM_MEMBER_ADDRESS_SEEDS: StaffTeamMemberAddressSeed[] = [
  {
    memberKey: 'alex_chen',
    name: 'HQ workspace',
    purpose: 'job address',
    companyName: 'Open Mercato',
    addressLine1: '120 Market Street',
    city: 'San Francisco',
    region: 'CA',
    postalCode: '94105',
    country: 'United States',
    isPrimary: true,
  },
  {
    memberKey: 'priya_nair',
    name: 'Home office',
    purpose: 'home address',
    addressLine1: '48 Maple Avenue',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'United States',
    isPrimary: true,
  },
  {
    memberKey: 'marta_lopez',
    name: 'Primary residence',
    purpose: 'home address',
    addressLine1: '19 Calle del Prado',
    city: 'Madrid',
    region: 'Community of Madrid',
    postalCode: '28014',
    country: 'Spain',
    isPrimary: true,
  },
  {
    memberKey: 'samir_haddad',
    name: 'Remote workspace',
    purpose: 'mailing address',
    addressLine1: '77 Cedar Lane',
    city: 'Manchester',
    region: 'Greater Manchester',
    postalCode: 'M1 1AA',
    country: 'United Kingdom',
    isPrimary: true,
  },
  {
    memberKey: 'jordan_kim',
    name: 'Operations hub',
    purpose: 'job address',
    companyName: 'Open Mercato',
    addressLine1: '350 Harbor Drive',
    city: 'Seattle',
    region: 'WA',
    postalCode: '98101',
    country: 'United States',
    isPrimary: true,
  },
]

const STAFF_ACTIVITY_TYPE_DICTIONARY_KEY = 'staff-activity-types'
const STAFF_ADDRESS_TYPE_DICTIONARY_KEY = 'staff-address-types'

const STAFF_ACTIVITY_TYPE_DEFAULTS: DictionarySeedEntry[] = [
  { value: 'Onboarding', label: 'Onboarding', icon: 'lucide:user-plus', color: '#2563eb' },
  { value: 'Training', label: 'Training', icon: 'lucide:graduation-cap', color: '#0ea5e9' },
  { value: 'Performance review', label: 'Performance review', icon: 'lucide:clipboard-list', color: '#8b5cf6' },
  { value: 'Certification', label: 'Certification', icon: 'lucide:badge-check', color: '#16a34a' },
  { value: 'Time off', label: 'Time off', icon: 'lucide:calendar-minus', color: '#f59e0b' },
  { value: 'Shift change', label: 'Shift change', icon: 'lucide:clock-3', color: '#22c55e' },
  { value: 'Role change', label: 'Role change', icon: 'lucide:shuffle', color: '#f97316' },
]

const STAFF_ADDRESS_TYPE_DEFAULTS: DictionarySeedEntry[] = [
  { value: 'home address', label: 'Home address' },
  { value: 'mailing address', label: 'Mailing address' },
  { value: 'job address', label: 'Job address' },
]

async function ensureStaffTeamMemberCustomFields(em: EntityManager, scope: StaffSeedScope) {
  const now = new Date()
  let config = await em.findOne(CustomFieldEntityConfig, {
    entityId: E.staff.staff_team_member,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!config) {
    config = em.create(CustomFieldEntityConfig, {
      entityId: E.staff.staff_team_member,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }
  config.configJson = {
    fieldsets: STAFF_TEAM_MEMBER_FIELDSETS,
    singleFieldsetPerRecord: false,
  }
  config.isActive = true
  config.updatedAt = now
  em.persist(config)

  await ensureCustomFieldDefinitions(em, STAFF_TEAM_MEMBER_CUSTOM_FIELD_SETS, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await ensureCustomFieldDefinitions(em, STAFF_TEAM_MEMBER_ACTIVITY_CUSTOM_FIELD_SETS, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.flush()
}

async function ensureStaffDictionary(
  em: EntityManager,
  scope: StaffSeedScope,
  definition: { key: string; name: string; description: string },
): Promise<Dictionary> {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: definition.key,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: definition.key,
      name: definition.name,
      description: definition.description,
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
  return dictionary
}

export async function seedStaffActivityTypes(
  em: EntityManager,
  scope: StaffSeedScope,
) {
  const dictionary = await ensureStaffDictionary(em, scope, {
    key: STAFF_ACTIVITY_TYPE_DICTIONARY_KEY,
    name: 'Staff activity types',
    description: 'Activity types for team member timelines (training, reviews, etc.).',
  })
  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingByValue = new Map(existingEntries.map((entry) => [entry.normalizedValue, entry]))
  for (const seed of STAFF_ACTIVITY_TYPE_DEFAULTS) {
    const value = seed.value.trim()
    if (!value) continue
    const normalizedValue = normalizeDictionaryValue(value)
    if (!normalizedValue) continue
    const color = sanitizeDictionaryColor(seed.color)
    const icon = sanitizeDictionaryIcon(seed.icon)
    const existing = existingByValue.get(normalizedValue)
    if (existing) {
      let updated = false
      if (!existing.label?.trim() && (seed.label ?? '').trim()) {
        existing.label = (seed.label ?? value).trim()
        updated = true
      }
      if (color !== undefined && existing.color !== color) {
        existing.color = color
        updated = true
      }
      if (icon !== undefined && existing.icon !== icon) {
        existing.icon = icon
        updated = true
      }
      if (updated) {
        existing.updatedAt = new Date()
        em.persist(existing)
      }
      continue
    }
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      value,
      normalizedValue,
      label: (seed.label ?? value).trim(),
      color: color ?? null,
      icon: icon ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
  await em.flush()
}

export async function seedStaffAddressTypes(
  em: EntityManager,
  scope: StaffSeedScope,
) {
  const dictionary = await ensureStaffDictionary(em, scope, {
    key: STAFF_ADDRESS_TYPE_DICTIONARY_KEY,
    name: 'Staff address types',
    description: 'Address types for team member profiles (home, mailing, job).',
  })
  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingByValue = new Map(existingEntries.map((entry) => [entry.normalizedValue, entry]))
  for (const seed of STAFF_ADDRESS_TYPE_DEFAULTS) {
    const value = seed.value.trim()
    if (!value) continue
    const normalizedValue = normalizeDictionaryValue(value)
    if (!normalizedValue) continue
    const existing = existingByValue.get(normalizedValue)
    if (existing) {
      if (!existing.label?.trim() && (seed.label ?? '').trim()) {
        existing.label = (seed.label ?? value).trim()
        existing.updatedAt = new Date()
        em.persist(existing)
      }
      continue
    }
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      value,
      normalizedValue,
      label: (seed.label ?? value).trim(),
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
  await em.flush()
}

async function fillMissingTeamMemberCustomFields(
  em: EntityManager,
  scope: StaffSeedScope,
  member: StaffTeamMember,
  customValues: Record<string, string | number | boolean | null | string[]>,
) {
  const keys = Object.keys(customValues)
  if (!keys.length) return
  const existingValues = await em.find(CustomFieldValue, {
    entityId: E.staff.staff_team_member,
    recordId: member.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    fieldKey: { $in: keys },
  })
  const existingKeys = new Set(existingValues.map((value) => value.fieldKey))
  const missingValues: Record<string, string | number | boolean | null | string[]> = {}
  for (const key of keys) {
    if (!existingKeys.has(key)) {
      missingValues[key] = customValues[key] ?? null
    }
  }
  if (Object.keys(missingValues).length === 0) return
  await setRecordCustomFields(em, {
    entityId: E.staff.staff_team_member,
    recordId: member.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    values: missingValues,
  })
}

async function fillMissingActivityCustomFields(
  em: EntityManager,
  scope: StaffSeedScope,
  activity: StaffTeamMemberActivity,
  customValues: Record<string, string | number | boolean | null>,
) {
  const keys = Object.keys(customValues)
  if (!keys.length) return
  const existingValues = await em.find(CustomFieldValue, {
    entityId: E.staff.staff_team_member_activity,
    recordId: activity.id,
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
    entityId: E.staff.staff_team_member_activity,
    recordId: activity.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    values: missingValues,
  })
}

export async function seedStaffTeamExamples(
  em: EntityManager,
  scope: StaffSeedScope,
) {
  await seedStaffActivityTypes(em, scope)
  await seedStaffAddressTypes(em, scope)
  await ensureStaffTeamMemberCustomFields(em, scope)
  const now = new Date()
  const teamNames = TEAM_SEEDS.map((seed) => seed.name)
  const existingTeams = await findWithDecryption(
    em,
    StaffTeam,
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
  const teamByKey = new Map<string, StaffTeam>()
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
    const record = em.create(StaffTeam, {
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
    StaffTeamRole,
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
  const roleByKey = new Map<string, StaffTeamRole>()
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
    const record = em.create(StaffTeamRole, {
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
    StaffTeamMember,
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

  const memberByKey = new Map<string, StaffTeamMember>()
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
      memberByKey.set(seed.key, existing)
      continue
    }
    const record = em.create(StaffTeamMember, {
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
    memberByKey.set(seed.key, record)
  }
  await em.flush()

  const memberSeedsByName = new Map(TEAM_MEMBER_SEEDS.map((seed) => [seed.displayName.toLowerCase(), seed]))
  const membersInScope = await findWithDecryption(
    em,
    StaffTeamMember,
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

  const seedDate = (daysAgo?: number) => {
    const date = new Date(now)
    if (typeof daysAgo === 'number') {
      date.setDate(date.getDate() - daysAgo)
    }
    return date
  }

  const memberIds = Array.from(memberByKey.values())
    .map((member) => member.id)
    .filter((id): id is string => typeof id === 'string')

  if (memberIds.length === 0) return

  const existingComments = await findWithDecryption(
    em,
    StaffTeamMemberComment,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      member: { $in: memberIds },
      deletedAt: null,
    },
    { populate: ['member'] },
    scope,
  )
  const commentKeys = new Set(
    existingComments.map((comment) => {
      const memberId = typeof comment.member === 'string' ? comment.member : comment.member.id
      const body = comment.body.trim().toLowerCase()
      return `${memberId}:${body}`
    }),
  )
  for (const seed of TEAM_MEMBER_NOTE_SEEDS) {
    const member = memberByKey.get(seed.memberKey)
    if (!member) continue
    const memberId = member.id
    const body = seed.body.trim()
    const key = `${memberId}:${body.toLowerCase()}`
    if (commentKeys.has(key)) continue
    const authorUserId = typeof seed.authorUserIndex === 'number'
      ? sortedUsers[seed.authorUserIndex]?.id ?? null
      : null
    const createdAt = seedDate(seed.daysAgo)
    const comment = em.create(StaffTeamMemberComment, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      member: em.getReference(StaffTeamMember, memberId),
      body,
      authorUserId,
      appearanceIcon: seed.appearanceIcon ?? null,
      appearanceColor: seed.appearanceColor ?? null,
      createdAt,
      updatedAt: createdAt,
    })
    em.persist(comment)
    commentKeys.add(key)
  }
  await em.flush()

  const existingActivities = await findWithDecryption(
    em,
    StaffTeamMemberActivity,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      member: { $in: memberIds },
    },
    { populate: ['member'] },
    scope,
  )
  const activityByKey = new Map<string, StaffTeamMemberActivity>()
  for (const activity of existingActivities) {
    const memberId = typeof activity.member === 'string' ? activity.member : activity.member.id
    const subject = activity.subject?.trim().toLowerCase() ?? ''
    const body = activity.body?.trim().toLowerCase() ?? ''
    const occurredAt = activity.occurredAt ? activity.occurredAt.toISOString().slice(0, 10) : ''
    const key = `${memberId}:${activity.activityType}:${subject}:${body}:${occurredAt}`
    activityByKey.set(key, activity)
  }
  for (const seed of TEAM_MEMBER_ACTIVITY_SEEDS) {
    const member = memberByKey.get(seed.memberKey)
    if (!member) continue
    const memberId = member.id
    const occurredAt = seedDate(seed.daysAgo)
    const subject = seed.subject?.trim() ?? null
    const body = seed.body?.trim() ?? null
    const key = `${memberId}:${seed.activityType}:${subject?.toLowerCase() ?? ''}:${body?.toLowerCase() ?? ''}:${occurredAt.toISOString().slice(0, 10)}`
    const existing = activityByKey.get(key)
    if (existing) {
      if (seed.customFields) {
        await fillMissingActivityCustomFields(em, scope, existing, seed.customFields)
      }
      continue
    }
    const authorUserId = typeof seed.authorUserIndex === 'number'
      ? sortedUsers[seed.authorUserIndex]?.id ?? null
      : null
    const activity = em.create(StaffTeamMemberActivity, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      member: em.getReference(StaffTeamMember, memberId),
      activityType: seed.activityType,
      subject,
      body,
      occurredAt,
      authorUserId,
      appearanceIcon: seed.appearanceIcon ?? null,
      appearanceColor: seed.appearanceColor ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(activity)
    activityByKey.set(key, activity)
    if (seed.customFields) {
      await em.flush()
      await fillMissingActivityCustomFields(em, scope, activity, seed.customFields)
    }
  }
  await em.flush()

  const existingAddresses = await findWithDecryption(
    em,
    StaffTeamMemberAddress,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      member: { $in: memberIds },
    },
    { populate: ['member'] },
    scope,
  )
  const addressKeys = new Set(
    existingAddresses.map((address) => {
      const memberId = typeof address.member === 'string' ? address.member : address.member.id
      const line1 = address.addressLine1.trim().toLowerCase()
      const postal = address.postalCode?.trim().toLowerCase() ?? ''
      return `${memberId}:${line1}:${postal}`
    }),
  )
  for (const seed of TEAM_MEMBER_ADDRESS_SEEDS) {
    const member = memberByKey.get(seed.memberKey)
    if (!member) continue
    const memberId = member.id
    const line1 = seed.addressLine1.trim()
    const postalCode = seed.postalCode?.trim() ?? null
    const key = `${memberId}:${line1.toLowerCase()}:${postalCode?.toLowerCase() ?? ''}`
    if (addressKeys.has(key)) continue
    const address = em.create(StaffTeamMemberAddress, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      member: em.getReference(StaffTeamMember, memberId),
      name: seed.name ?? null,
      purpose: seed.purpose ?? null,
      companyName: seed.companyName ?? null,
      addressLine1: line1,
      addressLine2: seed.addressLine2 ?? null,
      buildingNumber: seed.buildingNumber ?? null,
      flatNumber: seed.flatNumber ?? null,
      city: seed.city ?? null,
      region: seed.region ?? null,
      postalCode,
      country: seed.country ?? null,
      latitude: seed.latitude ?? null,
      longitude: seed.longitude ?? null,
      isPrimary: seed.isPrimary ?? false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(address)
    addressKeys.add(key)
  }
  await em.flush()
}
