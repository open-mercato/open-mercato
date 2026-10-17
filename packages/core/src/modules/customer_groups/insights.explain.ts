import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import {
  isExplainRecordId,
  resolveExplainDecryptionScope,
  resolveExplainNullableOrganizationWhere,
  toExplainTimestamp,
} from '@open-mercato/shared/modules/insights/helpers'
import { CustomerGroup } from './data/entities'

export const CUSTOMER_GROUP_EXPLAIN_RESOURCE_KIND = 'customer_groups.group'

async function loadCustomerGroupCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const organizationWhere = resolveExplainNullableOrganizationWhere(ctx.scope)
  if (!organizationWhere || !isExplainRecordId(id)) return null
  const group = await findOneWithDecryption(
    ctx.em,
    CustomerGroup,
    { id, tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  if (!group) return null
  return {
    id: group.id,
    organizationId: group.organizationId ?? null,
    updatedAt: toExplainTimestamp(group.updatedAt),
    name: group.name,
    isActive: group.isActive,
  }
}

export const explainConfig = defineExplainConfig({
  version: 1,
  resources: [
    {
      resourceKind: CUSTOMER_GROUP_EXPLAIN_RESOURCE_KIND,
      logResourceKinds: [],
      labelKey: 'customer_groups.insights.resources.group',
      formEntityIds: ['customer_groups.customer_group'],
      requiredFeatures: ['customer_groups.groups.view'],
      loadCurrent: loadCustomerGroupCurrent,
      noHistory: { reasonKey: 'customer_groups.insights.noHistory' },
      fields: [
        {
          key: 'name',
          labelKey: 'customer_groups.insights.fields.name',
          valueKind: 'text',
          snapshotPaths: [],
          changeKeys: [],
          currentPath: 'name',
        },
        {
          key: 'isActive',
          labelKey: 'customer_groups.insights.fields.isActive',
          valueKind: 'boolean',
          snapshotPaths: [],
          changeKeys: [],
          currentPath: 'isActive',
        },
      ],
      recordHref: (id) => `/backend/customer-groups/${encodeURIComponent(id)}/edit`,
    },
  ],
})

export default explainConfig
