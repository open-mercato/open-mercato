import { type APIRequestContext, expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
  type Operation,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-006 customers.addresses primary flag.
 *
 * Creating or updating an address with `isPrimary: true` demotes the customer's other primary
 * address. Undoing that operation must hand the primary flag back to the address that lost it,
 * unless something changed in between (another primary was chosen, the promoted address was
 * un-set or removed, or the demoted address is gone). Each test builds its own person and
 * addresses and reads state back through the address list, which is served from the table.
 */
const ADDRESSES_PATH = '/api/customers/addresses'

type AddressListItem = {
  id: string
  is_primary?: boolean | null
  updated_at?: string | null
}

async function createPerson(request: APIRequestContext, token: string, label: string): Promise<string> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
  return createPersonFixture(request, token, {
    firstName: 'Undo',
    lastName: `Primary ${label} ${stamp}`,
    displayName: `Undo Primary ${label} ${stamp}`,
  })
}

async function createAddress(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ id: string; operation: Operation }> {
  const response = await apiRequest(request, 'POST', ADDRESSES_PATH, { token, data })
  const payload = (await readJsonSafe(response)) as { id?: string } | null
  expect(response.ok(), `Failed to create address: ${response.status()}`).toBeTruthy()
  expect(typeof payload?.id, 'address create response should expose id').toBe('string')
  return { id: payload?.id as string, operation: expectOperation(response, 'address create') }
}

async function updateAddress(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<Operation> {
  const response = await apiRequest(request, 'PUT', ADDRESSES_PATH, { token, data })
  expect(response.ok(), `Failed to update address: ${response.status()}`).toBeTruthy()
  return expectOperation(response, 'address update')
}

async function deleteAddress(request: APIRequestContext, token: string, id: string): Promise<void> {
  const response = await apiRequest(request, 'DELETE', ADDRESSES_PATH, { token, data: { id } })
  expect(response.ok(), `Failed to delete address: ${response.status()}`).toBeTruthy()
}

async function listAddresses(request: APIRequestContext, token: string, entityId: string): Promise<AddressListItem[]> {
  const response = await apiRequest(request, 'GET', `${ADDRESSES_PATH}?entityId=${encodeURIComponent(entityId)}`, {
    token,
  })
  expect(response.ok(), `Failed to list addresses: ${response.status()}`).toBeTruthy()
  const body = (await readJsonSafe(response)) as { items?: AddressListItem[] } | null
  return body?.items ?? []
}

async function primaryIds(request: APIRequestContext, token: string, entityId: string): Promise<string[]> {
  const items = await listAddresses(request, token, entityId)
  return items.filter((item) => item.is_primary === true).map((item) => item.id)
}

test.describe('TC-UNDO-006 customers.addresses primary flag undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('undoing a primary address create gives the flag back, through redo as well', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    try {
      personId = await createPerson(request, token, 'create')
      const first = await createAddress(request, token, { entityId: personId, addressLine1: 'First', isPrimary: true })
      const versionBefore = (await listAddresses(request, token, personId))[0]?.updated_at
      const second = await createAddress(request, token, { entityId: personId, addressLine1: 'Second', isPrimary: true })
      expect(await primaryIds(request, token, personId)).toEqual([second.id])

      await undoOk(request, token, second.operation.undoToken, 'primary address create')
      const afterUndo = await listAddresses(request, token, personId)
      expect(afterUndo.map((item) => item.id)).toEqual([first.id])
      expect(afterUndo[0].is_primary, 'first address should be primary again after undo').toBe(true)

      const redone = await redoOk(request, token, second.operation.logId, 'primary address create')
      expect(await primaryIds(request, token, personId)).toEqual([second.id])

      expect(redone.undoToken, 'redo should issue a new undo token').toBeTruthy()
      await undoOk(request, token, redone.undoToken as string, 'primary address create redo')
      const afterSecondUndo = await listAddresses(request, token, personId)
      expect(afterSecondUndo.map((item) => item.id)).toEqual([first.id])
      expect(afterSecondUndo[0].is_primary, 'first address should be primary again after undoing the redo').toBe(true)
      expect(versionBefore, 'address list should expose updated_at').toBeTruthy()
      expect(afterSecondUndo[0].updated_at, 'demoting and restoring must not bump the sibling version').toBe(versionBefore)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('undoing a promotion to primary gives the flag back, through redo as well', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    try {
      personId = await createPerson(request, token, 'update')
      const first = await createAddress(request, token, { entityId: personId, addressLine1: 'First', isPrimary: true })
      const second = await createAddress(request, token, { entityId: personId, addressLine1: 'Second' })
      const versionBefore = (await listAddresses(request, token, personId)).find((item) => item.id === first.id)?.updated_at

      const promotion = await updateAddress(request, token, { id: second.id, isPrimary: true })
      expect(await primaryIds(request, token, personId)).toEqual([second.id])

      await undoOk(request, token, promotion.undoToken, 'address promotion')
      expect(await primaryIds(request, token, personId)).toEqual([first.id])

      const redone = await redoOk(request, token, promotion.logId, 'address promotion')
      expect(await primaryIds(request, token, personId)).toEqual([second.id])

      expect(redone.undoToken, 'redo should issue a new undo token').toBeTruthy()
      await undoOk(request, token, redone.undoToken as string, 'address promotion redo')
      expect(await primaryIds(request, token, personId)).toEqual([first.id])

      const versionAfter = (await listAddresses(request, token, personId)).find((item) => item.id === first.id)?.updated_at
      expect(versionBefore, 'address list should expose updated_at').toBeTruthy()
      expect(versionAfter, 'demoting and restoring must not bump the sibling version').toBe(versionBefore)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('undo keeps a primary address chosen after the undone create', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    try {
      personId = await createPerson(request, token, 'later-primary')
      await createAddress(request, token, { entityId: personId, addressLine1: 'First', isPrimary: true })
      const third = await createAddress(request, token, { entityId: personId, addressLine1: 'Third' })
      const second = await createAddress(request, token, { entityId: personId, addressLine1: 'Second', isPrimary: true })
      await updateAddress(request, token, { id: third.id, isPrimary: true })

      await undoOk(request, token, second.operation.undoToken, 'primary address create after a later promotion')

      expect(await primaryIds(request, token, personId)).toEqual([third.id])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('undo keeps the customer without a primary address once the flag was cleared', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    try {
      personId = await createPerson(request, token, 'no-primary')
      await createAddress(request, token, { entityId: personId, addressLine1: 'First', isPrimary: true })
      const promoted = await createAddress(request, token, { entityId: personId, addressLine1: 'Second' })
      const promotion = await updateAddress(request, token, { id: promoted.id, isPrimary: true })
      const extra = await createAddress(request, token, { entityId: personId, addressLine1: 'Third', isPrimary: true })
      await updateAddress(request, token, { id: extra.id, isPrimary: false })
      expect(await primaryIds(request, token, personId)).toEqual([])

      await undoOk(request, token, promotion.undoToken, 'address promotion after the primary flag was cleared')

      expect(await primaryIds(request, token, personId)).toEqual([])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('undo of a primary address create copes with the demoted address being deleted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    try {
      personId = await createPerson(request, token, 'deleted-sibling')
      const doomed = await createAddress(request, token, { entityId: personId, addressLine1: 'First', isPrimary: true })
      const created = await createAddress(request, token, { entityId: personId, addressLine1: 'Second', isPrimary: true })
      await deleteAddress(request, token, doomed.id)

      await undoOk(request, token, created.operation.undoToken, 'primary address create after the sibling was deleted')

      expect(await listAddresses(request, token, personId)).toEqual([])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('undoing a move to another customer restores the primary address of both customers', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let targetPersonId: string | null = null
    let sourcePersonId: string | null = null
    try {
      targetPersonId = await createPerson(request, token, 'move-target')
      sourcePersonId = await createPerson(request, token, 'move-source')
      const resident = await createAddress(request, token, { entityId: targetPersonId, addressLine1: 'Resident', isPrimary: true })
      const moving = await createAddress(request, token, { entityId: sourcePersonId, addressLine1: 'Moving', isPrimary: true })
      const move = await updateAddress(request, token, { id: moving.id, entityId: targetPersonId, isPrimary: true })
      expect(await primaryIds(request, token, targetPersonId)).toEqual([moving.id])

      await undoOk(request, token, move.undoToken, 'primary address move')

      expect(await primaryIds(request, token, targetPersonId)).toEqual([resident.id])
      expect(await primaryIds(request, token, sourcePersonId)).toEqual([moving.id])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', targetPersonId)
      await deleteEntityIfExists(request, token, '/api/customers/people', sourcePersonId)
    }
  })
})
