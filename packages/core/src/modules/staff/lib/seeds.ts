import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeam, StaffTeamMember, StaffTeamRole } from '../data/entities'
import { E } from '#generated/entities.ids.generated'

export type StaffSeedScope = { tenantId: string; organizationId: string }

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
  customFields?: Record<string, string | number | boolean | null>
}

type StaffTeamSeed = {
  key: string
  name: string
  description?: string | null
}

const TEAM_ROLE_SEEDS: StaffTeamRoleSeed[] = [
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

const TEAM_SEEDS: StaffTeamSeed[] = [
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

const TEAM_MEMBER_SEEDS: StaffTeamMemberSeed[] = [
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
  scope: StaffSeedScope,
  member: StaffTeamMember,
  customValues: Record<string, string | number | boolean | null>,
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
  const missingValues: Record<string, string | number | boolean | null> = {}
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
