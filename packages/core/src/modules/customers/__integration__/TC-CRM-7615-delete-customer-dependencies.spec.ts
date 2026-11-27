import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectOperation, redoOk, undoOk, undoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

async function dependentRows(roleId: string, billingId: string) {
  return withClient(async (client) => {
    const roles = await client.query('select * from customer_person_company_roles where id = $1', [roleId])
    const billing = await client.query('select * from customer_company_billing where id = $1', [billingId])
    return { roles: roles.rows, billing: billing.rows }
  })
}

for (const kind of ['person', 'company'] as const) {
  test(`TC-CRM-7615: delete a ${kind} with dependent customer records`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const roleId = randomUUID()
    const billingId = randomUUID()
    let personId: string | null = null
    let companyId: string | null = null

    try {
      companyId = await createCompanyFixture(request, token, `TC-CRM-7615 ${billingId}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'Customer',
        lastName: 'Dependencies',
        displayName: `TC-CRM-7615 ${roleId}`,
      })
      await withClient(async (client) => {
        await client.query(
          `insert into customer_person_company_roles
            (id, organization_id, tenant_id, person_entity_id, company_entity_id, role_value, created_at)
            select $1, organization_id, tenant_id, id, $3, 'buyer', '2026-01-01T00:00:00Z'
            from customer_entities where id = $2`,
          [roleId, personId, companyId],
        )
        await client.query(
          `insert into customer_company_billing
            (id, organization_id, tenant_id, entity_id, bank_name, bank_account_masked, payment_terms, preferred_currency, created_at, updated_at)
            select $1, organization_id, tenant_id, id, 'Test bank', '****1234', 'net 30', 'EUR',
              '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'
            from customer_entities where id = $2`,
          [billingId, companyId],
        )
      })

      const before = await dependentRows(roleId, billingId)
      expect(before.roles).toHaveLength(1)
      expect(before.billing).toHaveLength(1)
      const path = kind === 'person' ? '/api/customers/people' : '/api/customers/companies'
      const targetId = kind === 'person' ? personId : companyId
      const otherId = kind === 'person' ? companyId : personId
      const deletion = await apiRequest(request, 'DELETE', `${path}?id=${targetId}`, { token })
      expect(deletion.status()).toBe(200)
      const afterDelete = { roles: [], billing: kind === 'person' ? before.billing : [] }
      expect(await dependentRows(roleId, billingId)).toEqual(afterDelete)
      await withClient(async (client) => {
        const { rows } = await client.query('select id from customer_entities where id = any($1::uuid[])', [[targetId, otherId]])
        expect(rows).toEqual([{ id: otherId }])
      })

      if (!undoTestsDisabled()) {
        const operation = expectOperation(deletion, `delete ${kind} with dependent records`)
        await undoOk(request, token, operation.undoToken, `restore ${kind} with dependent records`)
        expect(await dependentRows(roleId, billingId)).toEqual(before)
        await redoOk(request, token, operation.logId, `delete ${kind} with dependent records again`)
        expect(await dependentRows(roleId, billingId)).toEqual(afterDelete)
      }
    } finally {
      await withClient(async (client) => {
        await client.query('delete from customer_person_company_roles where id = $1', [roleId])
        await client.query('delete from customer_company_billing where id = $1', [billingId])
      })
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
}
