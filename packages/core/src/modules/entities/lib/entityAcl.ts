import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { deriveCustomEntityRecordFeature } from './recordFeatures'

export type EntityAclRequirement = {
  view: string[]
  manage: string[]
  platformOnly?: boolean
}

const ENTITY_ACL_REQUIREMENTS: Record<string, EntityAclRequirement> = {
  'directory:tenant': {
    view: ['directory.tenants.view'],
    manage: ['directory.tenants.manage'],
    platformOnly: true,
  },
  'directory:organization': {
    view: ['directory.organizations.view'],
    manage: ['directory.organizations.manage'],
  },
  'customers:customer_person_profile': {
    view: ['customers.people.view'],
    manage: ['customers.people.manage'],
  },
  'customers:customer_company_profile': {
    view: ['customers.companies.view'],
    manage: ['customers.companies.manage'],
  },
  'customers:customer_deal': {
    view: ['customers.deals.view'],
    manage: ['customers.deals.manage'],
  },
  'customers:customer_activity': {
    view: ['customers.activities.view'],
    manage: ['customers.activities.manage'],
  },
  'customers:customer_interaction': {
    view: ['customers.interactions.view'],
    manage: ['customers.interactions.manage'],
  },
  'catalog:catalog_product': {
    view: ['catalog.products.view'],
    manage: ['catalog.products.manage'],
  },
  'catalog:catalog_product_category': {
    view: ['catalog.categories.view'],
    manage: ['catalog.categories.manage'],
  },
  'sales:sales_order': {
    view: ['sales.orders.view'],
    manage: ['sales.orders.manage'],
  },
  'sales:sales_quote': {
    view: ['sales.quotes.view'],
    manage: ['sales.quotes.manage'],
  },
  'auth:user': {
    view: ['auth.users.list'],
    manage: ['auth.users.edit'],
  },
  'auth:role': {
    view: ['auth.roles.list'],
    manage: ['auth.roles.manage'],
  },
}

let declaredCustomEntityRestrictions: Map<string, boolean> | null = null

function loadDeclaredCustomEntityRestrictions(): Map<string, boolean> {
  if (declaredCustomEntityRestrictions === null) {
    try {
      const modules = getModules() as Array<{
        customEntities?: Array<{ id?: string; accessRestricted?: boolean }>
      }>
      const restrictions = new Map<string, boolean>()
      for (const moduleEntry of modules ?? []) {
        for (const spec of moduleEntry.customEntities ?? []) {
          if (spec.id) restrictions.set(spec.id, spec.accessRestricted === true)
        }
      }
      declaredCustomEntityRestrictions = restrictions
    } catch {}
  }
  return declaredCustomEntityRestrictions ?? new Map<string, boolean>()
}

export function getDeclaredCustomEntityRestriction(entityId: string): boolean | undefined {
  return loadDeclaredCustomEntityRestrictions().get(entityId)
}

export function isDeclaredCustomEntity(entityId: string): boolean {
  return loadDeclaredCustomEntityRestrictions().has(entityId)
}

export function resolveEntityAclRequirement(entityId: string): EntityAclRequirement | null {
  return ENTITY_ACL_REQUIREMENTS[entityId] ?? null
}

export function canReadAllEntityMetadata(acl: {
  isSuperAdmin?: boolean
  features?: readonly string[]
}): boolean {
  return authorizeFeatures(['entities.definitions.view'], {
    grantedFeatures: acl.features ?? [],
    unrestricted: Boolean(acl.isSuperAdmin),
  })
}

export function canReadEntityMetadata(args: {
  entityId: string
  isCustomEntity: boolean
  isRestricted?: boolean
  acl: { isSuperAdmin?: boolean; features?: readonly string[] }
}): boolean {
  const requirement = resolveEntityAclRequirement(args.entityId)
  if (requirement?.platformOnly) {
    return Boolean(args.acl.isSuperAdmin) && authorizeFeatures(requirement.view, {
      grantedFeatures: args.acl.features ?? [],
      unrestricted: true,
    })
  }
  if (canReadAllEntityMetadata(args.acl)) return true
  if (args.isCustomEntity) {
    const requiredFeatures = ['entities.records.view']
    if (args.isRestricted) {
      requiredFeatures.push(deriveCustomEntityRecordFeature(args.entityId, 'view'))
    }
    return authorizeFeatures(requiredFeatures, {
      grantedFeatures: args.acl.features ?? [],
      unrestricted: Boolean(args.acl.isSuperAdmin),
    })
  }
  if (!requirement) return Boolean(args.acl.isSuperAdmin)
  return authorizeFeatures(requirement.view, {
    grantedFeatures: args.acl.features ?? [],
    unrestricted: Boolean(args.acl.isSuperAdmin),
  })
}

type EntityAclActor = {
  sub?: string | null
  tenantId?: string | null
  orgId?: string | null
  isSuperAdmin?: boolean
}

type AssertEntityAclArgs = {
  auth: EntityAclActor
  entityId: string
  action: 'view' | 'manage'
  isCustomEntity: boolean
  // Set for a custom entity flagged `access_restricted`. When true, the coarse
  // route-level entities.records.* feature is no longer sufficient — the caller
  // must additionally hold the synthesized per-entity feature.
  isRestricted?: boolean
  rbac: RbacService
}

function forbiddenEntityAccess(): CrudHttpError {
  return new CrudHttpError(403, { error: 'Forbidden' })
}

async function loadActorAcl(args: AssertEntityAclArgs) {
  return args.rbac.loadAcl(args.auth.sub ?? '', {
    tenantId: args.auth.tenantId ?? null,
    organizationId: args.auth.orgId ?? null,
  })
}

export async function assertEntityAclForRequest(args: AssertEntityAclArgs): Promise<void> {
  if (args.isCustomEntity) {
    // Unrestricted custom entities keep the historical behavior: the coarse
    // entities.records.view/.manage route guard is the whole authorization.
    if (!args.isRestricted) return

    const required = deriveCustomEntityRecordFeature(args.entityId, args.action)
    const allowed = await args.rbac.userHasAllFeatures(
      args.auth.sub ?? '',
      [required],
      {
        tenantId: args.auth.tenantId ?? null,
        organizationId: args.auth.orgId ?? null,
      },
    )
    if (!allowed) {
      throw forbiddenEntityAccess()
    }
    return
  }

  const requirement = resolveEntityAclRequirement(args.entityId)

  if (!requirement) {
    const acl = await loadActorAcl(args)
    if (!acl.isSuperAdmin) throw forbiddenEntityAccess()
    return
  }

  if (requirement.platformOnly) {
    const acl = await loadActorAcl(args)
    if (!acl.isSuperAdmin) throw forbiddenEntityAccess()
  }

  const allowed = await args.rbac.userHasAllFeatures(
    args.auth.sub ?? '',
    requirement[args.action],
    {
      tenantId: args.auth.tenantId ?? null,
      organizationId: args.auth.orgId ?? null,
    },
  )
  if (!allowed) {
    throw forbiddenEntityAccess()
  }
}
