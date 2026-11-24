import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type Bucket = { groupKey: string; value: number }
type WidgetResponse = { data: Bucket[] }
type BatchResponse = { results: Array<{ id: string; ok: boolean; data?: WidgetResponse }> }

export const integrationMeta = { dependsOnModules: ['customers'] }

test('TC-DASH-015: single and batched widgets cap grouped results at 100 buckets', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(token)
  const ids = Array.from({ length: 101 }, () => randomUUID())
  const idSet = new Set<string>(ids)
  const widget = {
    entityType: 'customers:entities',
    metric: { field: 'id', aggregate: 'count' },
    groupBy: { field: 'id' },
    filters: [{ field: 'id', operator: 'in', value: ids }],
  }

  try {
    await withClient((client) => client.query(
      `insert into customer_entities
        (id, tenant_id, organization_id, kind, display_name, is_active, created_at, updated_at)
       select id, $2, $3, 'person', 'QA bucket fixture', true, now(), now()
       from unnest($1::uuid[]) as fixture_rows(id)`,
      [ids, tenantId, organizationId],
    ))

    const single = await apiRequest(request, 'POST', '/api/dashboards/widgets/data', { token, data: widget })
    expect(single.status()).toBe(200)
    const singleBuckets = (await readJsonSafe<WidgetResponse>(single))?.data ?? []
    expect(singleBuckets).toHaveLength(100)
    expect(new Set(singleBuckets.map(({ groupKey }) => groupKey)).size).toBe(100)
    expect(singleBuckets.every(({ groupKey, value }) => idSet.has(groupKey) && value === 1)).toBe(true)

    const batch = await apiRequest(request, 'POST', '/api/dashboards/widgets/data/batch', {
      token,
      data: {
        requests: [
          { id: 'default', request: widget },
          { id: 'five', request: { ...widget, groupBy: { ...widget.groupBy, limit: 5 } } },
        ],
      },
    })
    expect(batch.status()).toBe(200)
    const results = (await readJsonSafe<BatchResponse>(batch))?.results ?? []
    expect(results.map(({ id, ok, data }) => [id, ok, data?.data.length])).toEqual([
      ['default', true, 100],
      ['five', true, 5],
    ])
  } finally {
    await withClient((client) => client.query('delete from customer_entities where id = any($1::uuid[])', [ids]))
  }
})
