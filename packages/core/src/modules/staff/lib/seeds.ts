import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue, sanitizeDictionaryColor, sanitizeDictionaryIcon } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { CustomFieldEntityConfig, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeam, StaffTeamMember, StaffTeamRole } from '../data/entities'
import { E } from '#generated/entities.ids.generated'
import {
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

const STAFF_ACTIVITY_TYPE_DICTIONARY_KEY = 'staff-activity-types'

const STAFF_ACTIVITY_TYPE_DEFAULTS: DictionarySeedEntry[] = [
  { value: 'Onboarding', label: 'Onboarding', icon: 'lucide:user-plus', color: '#2563eb' },
  { value: 'Training', label: 'Training', icon: 'lucide:graduation-cap', color: '#0ea5e9' },
  { value: 'Performance review', label: 'Performance review', icon: 'lucide:clipboard-list', color: '#8b5cf6' },
  { value: 'Certification', label: 'Certification', icon: 'lucide:badge-check', color: '#16a34a' },
  { value: 'Time off', label: 'Time off', icon: 'lucide:calendar-minus', color: '#f59e0b' },
  { value: 'Shift change', label: 'Shift change', icon: 'lucide:clock-3', color: '#22c55e' },
  { value: 'Role change', label: 'Role change', icon: 'lucide:shuffle', color: '#f97316' },
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
    name: 'Team member activity types',
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

export async function seedStaffTeamExamples(
  em: EntityManager,
  scope: StaffSeedScope,
) {
  await seedStaffActivityTypes(em, scope)
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
}
