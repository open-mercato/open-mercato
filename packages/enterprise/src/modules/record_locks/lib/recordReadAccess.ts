import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import { z } from 'zod'
import { RoleAcl, User } from '@open-mercato/core/modules/auth/data/entities'
import { isRoleEffectivelySuperAdmin, listSuperAdminUserIds } from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

type ReadTarget = {
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  userId: string
}

type ReadPolicy = {
  entity: string
  feature: string
  filters?: Record<string, unknown>
  tenantOnly?: boolean
}

const policies: ReadonlyMap<string, ReadPolicy> = new Map(Object.entries({
  'auth.user': { entity: 'User', feature: 'auth.users.list' },
  'auth.role': { entity: 'Role', feature: 'auth.roles.list', tenantOnly: true },
  'auth.role_acl': { entity: 'RoleAcl', feature: 'auth.acl.manage', tenantOnly: true },
  'business_rules.rule': { entity: 'BusinessRule', feature: 'business_rules.view' },
  'catalog.category': { entity: 'CatalogProductCategory', feature: 'catalog.categories.view' },
  'catalog.product_category': { entity: 'CatalogProductCategory', feature: 'catalog.categories.view' },
  'catalog.price_kind': { entity: 'CatalogPriceKind', feature: 'catalog.settings.manage', tenantOnly: true },
  'catalog.product': { entity: 'CatalogProduct', feature: 'catalog.products.view' },
  'catalog.product_variant': { entity: 'CatalogProductVariant', feature: 'catalog.products.view' },
  'catalog.variant': { entity: 'CatalogProductVariant', feature: 'catalog.products.view' },
  'checkout.link': { entity: 'CheckoutLink', feature: 'checkout.view' },
  'checkout.template': { entity: 'CheckoutLinkTemplate', feature: 'checkout.view' },
  'checkout.link_template': { entity: 'CheckoutLinkTemplate', feature: 'checkout.view' },
  'currencies.currency': { entity: 'Currency', feature: 'currencies.view' },
  'customers.activity': { entity: 'CustomerActivity', feature: 'customers.activities.view' },
  'customers.comment': { entity: 'CustomerComment', feature: 'customers.activities.view' },
  'customers.company': { entity: 'CustomerEntity', feature: 'customers.companies.view', filters: { kind: 'company' } },
  'customers.deal': { entity: 'CustomerDeal', feature: 'customers.deals.view' },
  'customers.interaction': { entity: 'CustomerInteraction', feature: 'customers.interactions.view' },
  'customers.person': { entity: 'CustomerEntity', feature: 'customers.people.view', filters: { kind: 'person' } },
  'customers.people': { entity: 'CustomerEntity', feature: 'customers.people.view', filters: { kind: 'person' } },
  'customers.pipeline': { entity: 'CustomerPipeline', feature: 'customers.pipelines.view' },
  'customers.pipelineStage': { entity: 'CustomerPipelineStage', feature: 'customers.pipelines.view' },
  'customers.pipeline_stage': { entity: 'CustomerPipelineStage', feature: 'customers.pipelines.view' },
  'customers.tag': { entity: 'CustomerTag', feature: 'customers.activities.view' },
  'dictionaries.entry': { entity: 'DictionaryEntry', feature: 'dictionaries.view' },
  'directory.organization': { entity: 'Organization', feature: 'directory.organizations.view' },
  'entities.record': { entity: 'CustomEntityStorage', feature: 'entities.records.view' },
  'feature_toggles.feature_toggle_override': { entity: 'FeatureToggleOverride', feature: 'feature_toggles.view', tenantOnly: true },
  'resources.resource': { entity: 'ResourcesResource', feature: 'resources.view' },
  'sales.channel': { entity: 'SalesChannel', feature: 'sales.channels.view' },
  'sales.order': { entity: 'SalesOrder', feature: 'sales.orders.view' },
  'sales.payment': { entity: 'SalesPayment', feature: 'sales.orders.view' },
  'sales.quote': { entity: 'SalesQuote', feature: 'sales.quotes.view' },
  'sales.shipment': { entity: 'SalesShipment', feature: 'sales.orders.view' },
  'staff.team': { entity: 'StaffTeam', feature: 'staff.view' },
  'webhooks.endpoint': { entity: 'WebhookEntity', feature: 'webhooks.view' },
  'workflows.definition': { entity: 'WorkflowDefinition', feature: 'workflows.definitions.view' },
}))

const uuid = z.string().uuid()

export async function canReadRecordLockTarget(
  em: EntityManager,
  rbac: Pick<RbacService, 'loadAclWithEntityManager'> | null,
  input: ReadTarget,
): Promise<boolean> {
  const policy = policies.get(input.resourceKind)
  const { tenantId, resourceId, userId } = input
  const organizationId = input.organizationId ?? null
  if (!rbac || !policy || ![tenantId, resourceId, userId].every((id) => uuid.safeParse(id).success)) return false
  if (organizationId !== null && !uuid.safeParse(organizationId).success) return false

  try {
    const readEm = em.fork()
    const metadata = readEm.getMetadata().getByClassName(policy.entity, false)
    if (!metadata) return false
    const entity = metadata.class as EntityName<Record<string, unknown>>

    const principal = await findOneWithDecryption(readEm, User, {
      id: userId, tenantId, deletedAt: null, isConfirmed: true,
    }, { fields: ['id', 'organizationId'] }, { tenantId, organizationId })
    if (!principal) return false

    const targetScope = { tenantId, organizationId: policy.entity === 'Organization' ? resourceId : organizationId }
    const acl = await rbac.loadAclWithEntityManager(readEm, userId, targetScope)
    const grants = { grantedFeatures: acl.features, unrestricted: acl.isSuperAdmin }
    if (!authorizeFeatures(['record_locks.view', policy.feature], grants)) return false

    const scope = await resolveOrganizationScope({
      em: readEm,
      rbac: { loadAcl: async () => acl },
      auth: { sub: userId, tenantId, orgId: principal.organizationId ?? null },
      selectedId: targetScope.organizationId ?? undefined,
    })
    if (scope.selectionRejected || isExplicitlyEmptyOrganizationScope(scope)) return false
    if (policy.entity === 'Organization' && organizationId !== null && organizationId !== resourceId) {
      const viewScope = await resolveOrganizationScope({
        em: readEm,
        rbac: { loadAcl: async () => acl },
        auth: { sub: userId, tenantId, orgId: principal.organizationId ?? null },
        selectedId: organizationId,
      })
      if (viewScope.selectionRejected || !viewScope.filterIds?.includes(resourceId)) return false
    }

    if (policy.entity === 'CustomEntityStorage') {
      const records = await findWithDecryption(readEm, entity,
        { entityId: resourceId, tenantId, organizationId, deletedAt: null },
        { fields: ['id', 'entityType'], limit: 2 }, targetScope)
      const entityType = records[0]?.entityType
      if (records.length !== 1 || typeof entityType !== 'string') return false
      const { classifyRecordsEntity } = await import('@open-mercato/core/modules/entities/lib/entityClassification')
      const { deriveCustomEntityRecordFeature } = await import('@open-mercato/core/modules/entities/lib/recordFeatures')
      const classification = await classifyRecordsEntity(readEm, entityType, targetScope)
      return classification.kind === 'custom' && (
        !classification.restricted || authorizeFeatures([deriveCustomEntityRecordFeature(entityType, 'view')], grants)
      )
    }

    const where: Record<string, unknown> = {
      id: resourceId,
      [policy.entity === 'Organization' ? 'tenant' : 'tenantId']: tenantId,
      ...policy.filters,
    }
    if (!policy.tenantOnly && policy.entity !== 'Organization') where.organizationId = organizationId
    if ('deletedAt' in metadata.properties) where.deletedAt = null

    if (policy.entity === 'CustomerInteraction') {
      const [{ listGrantsForViewer, listSharedChannelIds }, { buildEmailVisibilityMikroFilter }] = await Promise.all([
        import('@open-mercato/core/modules/customers/lib/conversationShares'),
        import('@open-mercato/core/modules/customers/lib/visibilityFilter'),
      ])
      const [sharedConversations, sharedChannelIds] = await Promise.all([
        listGrantsForViewer(readEm, targetScope, userId),
        listSharedChannelIds(readEm, targetScope, userId),
      ])
      Object.assign(where, buildEmailVisibilityMikroFilter({
        currentUserId: userId, userFeatures: acl.features, sharedConversations, sharedChannelIds,
      }))
    }

    if (!acl.isSuperAdmin && policy.entity === 'Role') {
      where.name = { $ne: 'superadmin' }
      if (await isRoleEffectivelySuperAdmin(readEm, resourceId)) return false
    }
    if (!acl.isSuperAdmin && policy.entity === 'User') {
      if ((await listSuperAdminUserIds(readEm, tenantId)).has(resourceId)) return false
    }
    if (policy.entity === 'RoleAcl') {
      const target = await findOneWithDecryption(readEm, RoleAcl, {
        id: resourceId, tenantId, deletedAt: null, role: { tenantId, deletedAt: null },
      }, { fields: ['id', 'role'] }, targetScope)
      return Boolean(target && (acl.isSuperAdmin || !await isRoleEffectivelySuperAdmin(readEm, target.role.id)))
    }

    return Boolean(await findOneWithDecryption(readEm, entity, where, { fields: ['id'] }, targetScope))
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'record_locks', code: 'record_locks.read_access_failed' })
    return false
  }
}
