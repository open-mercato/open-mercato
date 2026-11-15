import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

test.describe('TC-SALES-9156: sales reference scope', () => {
  for (const foreignScope of ['tenant', 'organization']) {
    test(`rejects ${foreignScope} references and hides their metadata on historical records`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(token)
      const dictionaryId = randomUUID()
      const entryId = randomUUID()
      const methodId = randomUUID()
      const foreignTenantId = foreignScope === 'tenant' ? randomUUID() : tenantId
      const foreignOrganizationId = randomUUID()
      const marker = `qa9156_${randomUUID().replaceAll('-', '')}`
      let orderId: string | null = null
      let shipmentId: string | null = null
      let paymentId: string | null = null

      const deleteShipment = async (id: string | null) => {
        if (!id || !orderId) return
        const response = await apiRequest(request, 'DELETE', '/api/sales/shipments', {
          token, data: { id, orderId },
        })
        expect(response.ok(), 'Shipment cleanup must succeed').toBeTruthy()
      }

      try {
        await withClient(async (client) => {
          if (foreignScope === 'tenant') {
            await client.query('insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())', [foreignTenantId, marker])
          }
          await client.query(
            `insert into organizations (id, tenant_id, name, is_active, ancestor_ids, child_ids, descendant_ids, depth, created_at, updated_at)
             values ($1, $2, $3, true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, now(), now())`,
            [foreignOrganizationId, foreignTenantId, marker],
          )
          await client.query(
            'insert into dictionaries (id, tenant_id, organization_id, key, name, is_system, is_active, created_at, updated_at) values ($1, $2, $3, $4, $4, false, true, now(), now())',
            [dictionaryId, tenantId, organizationId, marker],
          )
          await client.query(
            'insert into dictionary_entries (id, dictionary_id, tenant_id, organization_id, value, normalized_value, label, created_at, updated_at) values ($1, $2, $3, $4, $5, $5, $5, now(), now())',
            [entryId, dictionaryId, tenantId, organizationId, marker],
          )
          await client.query(
            'insert into sales_shipping_methods (id, tenant_id, organization_id, name, code, created_at, updated_at) values ($1, $2, $3, $4, $4, now(), now())',
            [methodId, tenantId, organizationId, marker],
          )
        })

        const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
          token, data: { currencyCode: 'USD', lines: [{ name: marker, currencyCode: 'USD', quantity: 10, unitPriceNet: 10, unitPriceGross: 10 }] },
        })
        expect(orderResponse.status()).toBe(201)
        orderId = expectId((await readJsonSafe<{ id?: string }>(orderResponse))?.id, 'Created order ID')
        const linesResponse = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}`, { token })
        expect(linesResponse.status()).toBe(200)
        const lines = await readJsonSafe<{ items: Array<{ id: string }> }>(linesResponse)
        const lineId = expectId(lines?.items[0]?.id, 'Created order line ID')
        const shipmentData = { orderId, shippingMethodId: methodId, statusEntryId: entryId, items: [{ orderLineId: lineId, quantity: 1 }] }
        const shipmentResponse = await apiRequest(request, 'POST', '/api/sales/shipments', { token, data: shipmentData })
        expect(shipmentResponse.status()).toBe(201)
        shipmentId = expectId((await readJsonSafe<{ id?: string }>(shipmentResponse))?.id, 'Created shipment ID')
        const paymentData = { orderId, statusEntryId: entryId, amount: 1, currencyCode: 'USD' }
        const paymentResponse = await apiRequest(request, 'POST', '/api/sales/payments', { token, data: paymentData })
        expect(paymentResponse.status()).toBe(201)
        paymentId = expectId((await readJsonSafe<{ id?: string }>(paymentResponse))?.id, 'Created payment ID')

        await withClient(async (client) => {
          for (const [table, id] of [['dictionaries', dictionaryId], ['dictionary_entries', entryId], ['sales_shipping_methods', methodId]]) {
            const moved = await client.query(
              `update ${table} set tenant_id = $1, organization_id = $2 where id = $3 and tenant_id = $4 and organization_id = $5`,
              [foreignTenantId, foreignOrganizationId, id, tenantId, organizationId],
            )
            expect(moved.rowCount).toBe(1)
          }
        })

        for (const [resource, id, data] of [
          ['shipments', shipmentId, shipmentData], ['payments', paymentId, paymentData],
        ] as const) {
          const rejectedCreate = await apiRequest(request, 'POST', `/api/sales/${resource}`, { token, data })
          if (rejectedCreate.ok()) {
            const unexpected = await readJsonSafe<{ id?: string }>(rejectedCreate)
            if (resource === 'shipments') await deleteShipment(unexpected?.id ?? null)
            else await deleteSalesEntityIfExists(request, token, `/api/sales/${resource}`, unexpected?.id ?? null)
          }
          expect(rejectedCreate.status()).toBe(400)
          const rejectedUpdate = await apiRequest(request, 'PUT', `/api/sales/${resource}`, {
            token, data: { id, statusEntryId: entryId },
          })
          expect(rejectedUpdate.status()).toBe(400)
          const list = await apiRequest(request, 'GET', `/api/sales/${resource}?orderId=${orderId}`, { token })
          expect(list.status()).toBe(200)
          const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(list)
          const record = body?.items.find((item) => item.id === id)
          expect(record).toBeDefined()
          expect(record?.status_label).toBeUndefined()
          expect(record?.shipping_method_name).toBeUndefined()
          expect(record?.shipping_method_code).toBeUndefined()
        }
        const rejectedMethodUpdate = await apiRequest(request, 'PUT', '/api/sales/shipments', {
          token, data: { id: shipmentId, shippingMethodId: methodId },
        })
        expect(rejectedMethodUpdate.status()).toBe(400)
      } finally {
        await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
        try {
          await deleteShipment(shipmentId)
        } finally {
          await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
          await withClient(async (client) => {
            await client.query('delete from dictionary_entries where id = $1 and dictionary_id = $2', [entryId, dictionaryId])
            await client.query('delete from dictionaries where id = $1', [dictionaryId])
            await client.query('delete from sales_shipping_methods where id = $1', [methodId])
            await client.query('delete from organizations where id = $1 and tenant_id = $2', [foreignOrganizationId, foreignTenantId])
            if (foreignScope === 'tenant') await client.query('delete from tenants where id = $1', [foreignTenantId])
          })
        }
      }
    })
  }
})
