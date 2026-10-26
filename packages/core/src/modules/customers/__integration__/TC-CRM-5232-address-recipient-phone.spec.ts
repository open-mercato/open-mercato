import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import { Migration20261026180000_customers_address_contact_encryption } from '@open-mercato/core/modules/customers/migrations/Migration20261026180000_customers_address_contact_encryption'

/**
 * TC-CRM-5232: address recipient name + phone (#5232, Phase 3 of
 * `.ai/specs/2026-08-10-address-contact-and-tax-fields.md`).
 *
 * Covers, through the real API + database:
 * 1. address create / update / read round-trip of `recipientName` + `phone`;
 * 2. the person / company detail payload carrying both fields;
 * 3. parent person / company delete → undo restoring both fields (and `companyName`, which the
 *    parent snapshot used to drop too) on the child addresses;
 * 4. the encryption upgrade path: a tenant whose `customers:customer_address` map predates the two
 *    columns gets them back from the backfill migration, and new writes are not stored as plaintext.
 */

const ADDRESSES = '/api/customers/addresses'
const PEOPLE = '/api/customers/people'
const COMPANIES = '/api/customers/companies'

type AddressItem = {
  id: string
  recipient_name?: string | null
  phone?: string | null
  company_name?: string | null
  address_line1?: string | null
}

async function createAddress(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ADDRESSES, { token, data })
  const payload = (await readJsonSafe(response)) as { id?: string; addressId?: string } | null
  expect(response.ok(), `create address status ${response.status()}`).toBeTruthy()
  const id = payload?.id ?? payload?.addressId
  expect(typeof id, 'address create response exposes id').toBe('string')
  return id as string
}

async function listAddresses(request: APIRequestContext, token: string, entityId: string): Promise<AddressItem[]> {
  const response = await apiRequest(request, 'GET', `${ADDRESSES}?entityId=${encodeURIComponent(entityId)}`, { token })
  expect(response.ok(), `list addresses status ${response.status()}`).toBeTruthy()
  return ((await readJsonSafe(response)) as { items?: AddressItem[] } | null)?.items ?? []
}

async function findAddress(request: APIRequestContext, token: string, entityId: string, id: string): Promise<AddressItem> {
  const items = await listAddresses(request, token, entityId)
  const match = items.find((item) => item.id === id)
  expect(match, `address ${id} should be listed for ${entityId}`).toBeTruthy()
  return match as AddressItem
}

async function readRawContact(addressId: string): Promise<{ recipient_name: string | null; phone: string | null }> {
  return withClient(async (client) => {
    const result = await client.query<{ recipient_name: string | null; phone: string | null }>(
      'select recipient_name, phone from customer_addresses where id = $1',
      [addressId],
    )
    expect(result.rows.length, 'address row exists').toBe(1)
    return result.rows[0]
  })
}

test.describe('TC-CRM-5232 address recipient name + phone', () => {
  test('address API persists recipientName + phone on create and update, and returns them on read', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `TC5232 Co ${stamp}`)
      const addressId = await createAddress(request, token, {
        entityId: companyId,
        addressLine1: `1 Contact St ${stamp}`,
        recipientName: `Alice ${stamp}`,
        phone: '+48 600 100 200',
      })

      const created = await findAddress(request, token, companyId, addressId)
      expect(created.recipient_name).toBe(`Alice ${stamp}`)
      expect(created.phone).toBe('+48 600 100 200')

      const updateRes = await apiRequest(request, 'PUT', ADDRESSES, {
        token,
        data: { id: addressId, recipientName: `Bob ${stamp}`, phone: '+48 600 300 400' },
      })
      expect(updateRes.ok(), `update address status ${updateRes.status()}`).toBeTruthy()

      const updated = await findAddress(request, token, companyId, addressId)
      expect(updated.recipient_name).toBe(`Bob ${stamp}`)
      expect(updated.phone).toBe('+48 600 300 400')
      expect(updated.address_line1, 'untouched columns survive a partial update').toBe(`1 Contact St ${stamp}`)

      // The company detail payload (what the Addresses tab / edit forms hydrate from) carries both too.
      const detailRes = await apiRequest(request, 'GET', `${COMPANIES}/${companyId}?include=addresses`, { token })
      expect(detailRes.ok()).toBeTruthy()
      const detail = (await readJsonSafe(detailRes)) as {
        addresses?: Array<{ id: string; recipientName?: string | null; phone?: string | null }>
      } | null
      const detailAddress = detail?.addresses?.find((entry) => entry.id === addressId)
      expect(detailAddress?.recipientName).toBe(`Bob ${stamp}`)
      expect(detailAddress?.phone).toBe('+48 600 300 400')
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES, companyId)
    }
  })

  test('person delete → undo restores address recipientName, phone and companyName', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'TC5232',
        lastName: `Person ${stamp}`,
        displayName: `TC5232 Person ${stamp}`,
      })
      const addressId = await createAddress(request, token, {
        entityId: personId,
        addressLine1: `2 Undo Ave ${stamp}`,
        recipientName: `Carol ${stamp}`,
        phone: '+49 30 123456',
        companyName: `Billing GmbH ${stamp}`,
      })

      const deleteRes = await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token })
      expect(deleteRes.ok(), `delete person status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'customers.people.delete')

      await undoOk(request, token, deleteOp.undoToken, 'undo delete person')

      const restored = await findAddress(request, token, personId, addressId)
      expect(restored.recipient_name, 'recipientName survives person delete → undo').toBe(`Carol ${stamp}`)
      expect(restored.phone, 'phone survives person delete → undo').toBe('+49 30 123456')
      expect(restored.company_name, 'companyName survives person delete → undo').toBe(`Billing GmbH ${stamp}`)
    } finally {
      await deleteEntityIfExists(request, token, PEOPLE, personId)
    }
  })

  test('company delete → undo restores address recipientName, phone and companyName', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `TC5232 Undo Co ${stamp}`)
      const addressId = await createAddress(request, token, {
        entityId: companyId,
        addressLine1: `3 Undo Blvd ${stamp}`,
        recipientName: `Dave ${stamp}`,
        phone: '+44 20 7946 0000',
        companyName: `Warehouse Ltd ${stamp}`,
      })

      const deleteRes = await apiRequest(request, 'DELETE', `${COMPANIES}?id=${companyId}`, { token })
      expect(deleteRes.ok(), `delete company status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'customers.companies.delete')

      await undoOk(request, token, deleteOp.undoToken, 'undo delete company')

      const restored = await findAddress(request, token, companyId, addressId)
      expect(restored.recipient_name, 'recipientName survives company delete → undo').toBe(`Dave ${stamp}`)
      expect(restored.phone, 'phone survives company delete → undo').toBe('+44 20 7946 0000')
      expect(restored.company_name, 'companyName survives company delete → undo').toBe(`Warehouse Ltd ${stamp}`)
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES, companyId)
    }
  })

  test('encryption upgrade: backfill migration adds the new rules and new writes are not plaintext', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const stamp = Date.now()
    const entityId = 'customers:customer_address'
    let companyId: string | null = null
    const backfillStatements: string[] = []

    const readRuleFields = () =>
      withClient(async (client) => {
        const result = await client.query<{ fields_json: Array<{ field: string }> | null }>(
          `select fields_json from encryption_maps
            where entity_id = $1 and tenant_id = $2 and organization_id is not distinct from $3
              and deleted_at is null and is_active = true`,
          [entityId, tenantId, organizationId],
        )
        return result.rows.flatMap((row) => (row.fields_json ?? []).map((rule) => rule.field))
      })

    // Encryption disabled for this tenant → no map to upgrade; the plaintext columns are expected.
    const initialFields = await readRuleFields()
    test.skip(initialFields.length === 0, 'tenant data encryption is not active for this tenant')

    // Collect the migration's SQL up front so the `finally` can always put the shared tenant back.
    const migration = Object.create(
      Migration20261026180000_customers_address_contact_encryption.prototype,
    ) as Migration20261026180000_customers_address_contact_encryption
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => backfillStatements.push(sql) })
    await migration.up()
    expect(backfillStatements).toHaveLength(1)

    try {
      // Given a tenant upgraded from before the columns existed: its map lacks the two rules.
      await withClient(async (client) => {
        await client.query(
          `update encryption_maps
              set fields_json = coalesce((
                select jsonb_agg(rule)
                  from jsonb_array_elements(fields_json) as rule
                 where rule->>'field' not in ('recipient_name', 'phone')
              ), '[]'::jsonb)
            where entity_id = $1 and tenant_id = $2 and organization_id is not distinct from $3
              and deleted_at is null`,
          [entityId, tenantId, organizationId],
        )
      })
      expect(await readRuleFields()).not.toContain('recipient_name')

      // When the forward-only migration runs (twice, to prove it is idempotent)
      await withClient(async (client) => {
        await client.query(backfillStatements[0])
        await client.query(backfillStatements[0])
      })

      // Then the map has each rule exactly once ...
      const afterBackfill = await readRuleFields()
      expect(afterBackfill.filter((field) => field === 'recipient_name')).toHaveLength(1)
      expect(afterBackfill.filter((field) => field === 'phone')).toHaveLength(1)
      for (const field of initialFields) expect(afterBackfill).toContain(field)

      // ... and a fresh write stores ciphertext in both columns while the API still reads plaintext.
      companyId = await createCompanyFixture(request, token, `TC5232 Enc Co ${stamp}`)
      const addressId = await createAddress(request, token, {
        entityId: companyId,
        addressLine1: `4 Cipher Way ${stamp}`,
        recipientName: `Erin Plaintext ${stamp}`,
        phone: '+1 555 010 9999',
      })
      const raw = await readRawContact(addressId)
      expect(raw.recipient_name, 'recipient_name must not be stored as plaintext').not.toBe(`Erin Plaintext ${stamp}`)
      expect(raw.recipient_name ?? '').not.toContain('Erin Plaintext')
      expect(raw.phone, 'phone must not be stored as plaintext').not.toBe('+1 555 010 9999')
      expect(raw.phone ?? '').not.toContain('555 010 9999')

      const read = await findAddress(request, token, companyId, addressId)
      expect(read.recipient_name).toBe(`Erin Plaintext ${stamp}`)
      expect(read.phone).toBe('+1 555 010 9999')
    } finally {
      // Leave the shared tenant with a complete map even if an assertion above failed mid-way.
      if (backfillStatements.length) {
        await withClient(async (client) => {
          await client.query(backfillStatements[0])
        })
      }
      await deleteEntityIfExists(request, token, COMPANIES, companyId)
    }
  })
})
