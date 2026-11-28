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
  'catalog:catalog_service': {
    view: ['catalog.services.view'],
    manage: ['catalog.services.manage'],
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
  'attachments:attachment': {
    view: ['attachments.view'],
    manage: ['attachments.manage'],
  },
  'catalog:catalog_product_variant': {
    view: ['catalog.products.view'],
    manage: ['catalog.variants.manage'],
  },
  'catalog:catalog_product_price': {
    view: ['catalog.products.view'],
    manage: ['catalog.pricing.manage'],
  },
  'customer_accounts:customer_user': {
    view: ['customer_accounts.view'],
    manage: ['customer_accounts.manage'],
  },
  'customer_accounts:customer_role': {
    view: ['customer_accounts.view'],
    manage: ['customer_accounts.roles.manage'],
  },
  'eudr:eudr_product_mapping': {
    view: ['eudr.mappings.view'],
    manage: ['eudr.mappings.manage'],
  },
  'eudr:eudr_evidence_submission': {
    view: ['eudr.submissions.view'],
    manage: ['eudr.submissions.manage'],
  },
  'eudr:eudr_due_diligence_statement': {
    view: ['eudr.statements.view'],
    manage: ['eudr.statements.manage'],
  },
  'eudr:eudr_plot': {
    view: ['eudr.plots.view'],
    manage: ['eudr.plots.manage'],
  },
  'eudr:eudr_risk_assessment': {
    view: ['eudr.risk.view'],
    manage: ['eudr.risk.manage'],
  },
  'eudr:eudr_mitigation_action': {
    view: ['eudr.risk.view'],
    manage: ['eudr.risk.manage'],
  },
  'inbox_ops:inbox_proposal': {
    view: ['inbox_ops.proposals.view'],
    manage: ['inbox_ops.proposals.manage'],
  },
  'sales:sales_order_line': {
    view: ['sales.orders.view'],
    manage: ['sales.orders.manage'],
  },
  'sales:sales_order_adjustment': {
    view: ['sales.orders.view'],
    manage: ['sales.orders.manage'],
  },
  'sales:sales_quote_line': {
    view: ['sales.quotes.view'],
    manage: ['sales.quotes.manage'],
  },
  'sales:sales_quote_adjustment': {
    view: ['sales.quotes.view'],
    manage: ['sales.quotes.manage'],
  },
  'sales:sales_invoice': {
    view: ['sales.invoices.manage'],
    manage: ['sales.invoices.manage'],
  },
  'sales:sales_invoice_line': {
    view: ['sales.invoices.manage'],
    manage: ['sales.invoices.manage'],
  },
  'sales:sales_payment': {
    view: ['sales.orders.view'],
    manage: ['sales.payments.manage'],
  },
  'sales:sales_payment_allocation': {
    view: ['sales.orders.view'],
    manage: ['sales.payments.manage'],
  },
  'sales:sales_credit_memo': {
    view: ['sales.credit_memos.manage'],
    manage: ['sales.credit_memos.manage'],
  },
  'sales:sales_credit_memo_line': {
    view: ['sales.credit_memos.manage'],
    manage: ['sales.credit_memos.manage'],
  },
  'sales:sales_shipment': {
    view: ['sales.orders.view'],
    manage: ['sales.shipments.manage'],
  },
  'sales:sales_shipment_item': {
    view: ['sales.orders.view'],
    manage: ['sales.shipments.manage'],
  },
  'sales:sales_note': {
    view: ['sales.orders.view', 'sales.quotes.view', 'sales.invoices.manage', 'sales.credit_memos.manage'],
    manage: ['sales.orders.manage', 'sales.quotes.manage', 'sales.invoices.manage', 'sales.credit_memos.manage'],
  },
  'staff:staff_team_member': {
    view: ['staff.view'],
    manage: ['staff.manage_team'],
  },
  'staff:staff_time_entry': {
    view: ['staff.timesheets.view'],
    manage: ['staff.timesheets.manage_own'],
  },
  'staff:staff_time_project': {
    view: ['staff.timesheets.projects.view'],
    manage: ['staff.timesheets.projects.manage'],
  },
  'staff:staff_time_task': {
    view: ['staff.timesheets.tasks.view'],
    manage: ['staff.timesheets.tasks.manage'],
  },
  'staff:staff_time_report': {
    view: ['staff.timesheets.reports.view'],
    manage: ['staff.timesheets.reports.manage'],
  },
  'staff:staff_time_tag': {
    view: ['staff.timesheets.view'],
    manage: ['staff.timesheets.tasks.manage'],
  },
  'warranty_claims:warranty_claim': {
    view: ['warranty_claims.claim.view'],
    manage: ['warranty_claims.claim.manage'],
  },
  'warranty_claims:warranty_claim_line': {
    view: ['warranty_claims.claim.view'],
    manage: ['warranty_claims.claim.manage'],
  },
  'warranty_claims:warranty_claim_registration': {
    view: ['warranty_claims.registration.view'],
    manage: ['warranty_claims.registration.manage'],
  },
  'warranty_claims:warranty_vendor_policy': {
    view: ['warranty_claims.vendor_policy.manage'],
    manage: ['warranty_claims.vendor_policy.manage'],
  },
  'warranty_claims:warranty_troubleshooting_guide': {
    view: ['warranty_claims.troubleshooting.manage'],
    manage: ['warranty_claims.troubleshooting.manage'],
  },
  'wms:warehouse': {
    view: ['wms.view'],
    manage: ['wms.manage_warehouses'],
  },
  'wms:warehouse_zone': {
    view: ['wms.view'],
    manage: ['wms.manage_zones'],
  },
  'wms:warehouse_location': {
    view: ['wms.view'],
    manage: ['wms.manage_locations'],
  },
  'wms:product_inventory_profile': {
    view: ['wms.view'],
    manage: ['wms.manage_inventory'],
  },
  'wms:inventory_lot': {
    view: ['wms.view'],
    manage: ['wms.manage_inventory'],
  },
  'wms:inventory_balance': {
    view: ['wms.view'],
    manage: ['wms.adjust_inventory'],
  },
  'wms:inventory_reservation': {
    view: ['wms.view'],
    manage: ['wms.manage_reservations'],
  },
  'wms:inventory_movement': {
    view: ['wms.view'],
    manage: ['wms.adjust_inventory'],
  },
  'wms:asn': {
    view: ['wms.view'],
    manage: ['wms.manage_asn'],
  },
  'wms:receiving_line': {
    view: ['wms.view'],
    manage: ['wms.manage_asn'],
  },
  'wms:putaway_task': {
    view: ['wms.view'],
    manage: ['wms.manage_putaway'],
  },
  'checkout:checkout_link': {
    view: ['checkout.view'],
    manage: ['checkout.edit'],
  },
  'checkout:checkout_link_template': {
    view: ['checkout.view'],
    manage: ['checkout.edit'],
  },
  'checkout:checkout_transaction': {
    view: ['checkout.view'],
    manage: ['checkout.edit'],
  },
  'example:todo': {
    view: ['example.todos.view'],
    manage: ['example.todos.manage'],
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
