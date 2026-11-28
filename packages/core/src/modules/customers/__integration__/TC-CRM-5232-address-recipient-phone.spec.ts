import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { withIsolatedAddressEncryptionActor, type AddressEncryptionActor } from './helpers/addressEncryptionFixtures'
import { addressEntity, replaceFixtureAddressPolicy } from './helpers/addressPolicyFixtures'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-CRM-5232: address recipient name + phone (#5232, Phase 3 of
 * `.ai/specs/2026-08-10-address-contact-and-tax-fields.md`).
 *
 * Covers, through the real API + database:
 * 1. address create / update / read round-trip of `recipientName` + `phone`;
 * 2. the person / company detail payload carrying both fields;
 * 3. parent person / company delete → undo restoring both fields (and `companyName`, which the
 *    parent snapshot used to drop too) on the child addresses;
 * 4. upgraded fixture policies encrypt fresh writes and retain dynamic inheritance without changing
 *    another tenant's policy. Unrestricted migration execution is covered in isolated PostgreSQL tests.
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
  purpose?: string | null
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

      // Clearing either contact field must clear the stored value, not keep the old one.
      const clearRes = await apiRequest(request, 'PUT', ADDRESSES, {
        token,
        data: { id: addressId, recipientName: null, phone: null },
      })
      expect(clearRes.ok(), `clear address contact status ${clearRes.status()}`).toBeTruthy()
      const cleared = await findAddress(request, token, companyId, addressId)
      expect(cleared.recipient_name, 'recipientName is cleared with an explicit null').toBeNull()
      expect(cleared.phone, 'phone is cleared with an explicit null').toBeNull()
      expect(cleared.address_line1, 'clearing contact data leaves the postal fields intact').toBe(`1 Contact St ${stamp}`)
      const clearedRaw = await readRawContact(addressId)
      expect(clearedRaw.recipient_name, 'cleared recipientName is null at rest').toBeNull()
      expect(clearedRaw.phone, 'cleared phone is null at rest').toBeNull()
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


  async function withUnchangedUnrelatedPolicy(actor: AddressEncryptionActor, run: () => Promise<void>) {
    const sentinelId = await withClient((client) => replaceFixtureAddressPolicy(
      client, actor.unrelatedTenantId, actor.unrelatedOrganizationId, [{ field: 'purpose' }],
    ))
    const read = () => withClient(async (client) => (await client.query(
      'select to_jsonb(policy) as policy from encryption_maps policy where id = $1', [sentinelId],
    )).rows)
    const before = await read()
    try { await run() } finally { expect(await read()).toEqual(before) }
  }

  async function requireEncryption(actor: AddressEncryptionActor) {
    const maps = await withClient((client) => client.query(
      'select id from encryption_maps where entity_id = $1 and (tenant_id = $2 or tenant_id is null) and deleted_at is null and is_active = true',
      [addressEntity, actor.tenantId],
    ))
    test.skip(maps.rows.length === 0, 'tenant data encryption is not active')
  }

  test('upgraded fixture policy encrypts contact writes without changing an unrelated tenant', async ({ request }) => {
    await withIsolatedAddressEncryptionActor(request, async (actor) => {
      await requireEncryption(actor)
      await withUnchangedUnrelatedPolicy(actor, async () => {
        const fields = [{ field: 'address_line1' }, { field: 'recipient_name' }, { field: 'phone' }]
        await withClient((client) => replaceFixtureAddressPolicy(client, actor.tenantId, actor.organizationId, fields))
        let companyId: string | null = null
        try {
          companyId = await createCompanyFixture(request, actor.token, 'Isolated encrypted contacts')
          const addressId = await createAddress(request, actor.token, {
            entityId: companyId, addressLine1: '4 Cipher Way', recipientName: 'Erin Plaintext', phone: '+1 555 010 9999',
          })
          const raw = await readRawContact(addressId)
          expect(isEncryptedPayloadShape(raw.recipient_name)).toBe(true)
          expect(isEncryptedPayloadShape(raw.phone)).toBe(true)
          const read = await findAddress(request, actor.token, companyId, addressId)
          expect(read.recipient_name).toBe('Erin Plaintext')
          expect(read.phone).toBe('+1 555 010 9999')
        } finally {
          await deleteEntityIfExists(request, actor.token, COMPANIES, companyId)
        }
      })
    })
  })

  test('an isolated organization inherits subsequent parent policy changes', async ({ request }) => {
    await withIsolatedAddressEncryptionActor(request, async (actor) => {
      await requireEncryption(actor)
      await withUnchangedUnrelatedPolicy(actor, async () => {
        const parentId = await withClient(async (client) => {
          await client.query('delete from encryption_maps where entity_id = $1 and tenant_id = $2 and organization_id = $3',
            [addressEntity, actor.tenantId, actor.organizationId])
          return replaceFixtureAddressPolicy(client, actor.tenantId, null, [
            { field: 'address_line1' }, { field: 'recipient_name' }, { field: 'phone' },
          ])
        })
        let companyId: string | null = null
        try {
          companyId = await createCompanyFixture(request, actor.token, 'Isolated inherited policy')
          const legacyId = await createAddress(request, actor.token, { entityId: companyId, addressLine1: '5 Legacy Cipher Rd' })
          await withClient((client) => client.query(
            'update encryption_maps set fields_json = fields_json || $2::jsonb, updated_at = now() where id = $1 and tenant_id = $3',
            [parentId, JSON.stringify([{ field: 'purpose' }]), actor.tenantId],
          ))
          const addressId = await createAddress(request, actor.token, {
            entityId: companyId, addressLine1: '6 Inherited Policy Rd', purpose: 'Inherited purpose',
          })
          expect((await findAddress(request, actor.token, companyId, addressId)).purpose).toBe('Inherited purpose')
          expect((await findAddress(request, actor.token, companyId, legacyId)).address_line1).toBe('5 Legacy Cipher Rd')
          const raw = await withClient((client) => client.query<{ purpose: string; address_line1: string }>(
            'select purpose, address_line1 from customer_addresses where id = $1', [addressId],
          ))
          expect(isEncryptedPayloadShape(raw.rows[0].purpose)).toBe(true)
          expect(isEncryptedPayloadShape(raw.rows[0].address_line1)).toBe(true)
          const overrides = await withClient((client) => client.query(
            'select id from encryption_maps where entity_id = $1 and tenant_id = $2 and organization_id = $3 and deleted_at is null',
            [addressEntity, actor.tenantId, actor.organizationId],
          ))
          expect(overrides.rows).toEqual([])
        } finally {
          await deleteEntityIfExists(request, actor.token, COMPANIES, companyId)
        }
      })
    })
  })
})
