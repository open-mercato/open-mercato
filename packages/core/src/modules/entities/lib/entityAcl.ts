import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

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

export function resolveEntityAclRequirement(entityId: string): EntityAclRequirement | null {
  return ENTITY_ACL_REQUIREMENTS[entityId] ?? null
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
  rbac: RbacService
}

function forbiddenEntityAccess(): CrudHttpError {
  return new CrudHttpError(403, { error: 'Forbidden' })
}

export async function assertEntityAclForRequest(args: AssertEntityAclArgs): Promise<void> {
  if (args.isCustomEntity) return

  const requirement = resolveEntityAclRequirement(args.entityId)

  const acl = await args.rbac.loadAcl(args.auth.sub ?? '', {
    tenantId: args.auth.tenantId ?? null,
    organizationId: args.auth.orgId ?? null,
  })

  if (acl?.isSuperAdmin) return

  if (!requirement) throw forbiddenEntityAccess()
  if (requirement.platformOnly) throw forbiddenEntityAccess()

  if (!hasAllFeatures(acl?.features, requirement[args.action])) {
    throw forbiddenEntityAccess()
  }
}
