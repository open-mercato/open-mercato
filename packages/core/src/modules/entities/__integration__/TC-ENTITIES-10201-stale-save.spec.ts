import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  listCustomEntities,
  listFieldDefinitions,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi'

test('a stale custom entity save leaves metadata and the other editor’s field intact', async ({ request }) => {
  test.setTimeout(60_000)
  const superToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(superToken)
  const organizationId = await createOrganizationFixture(request, superToken, {
    name: `Stale entity save ${randomUUID()}`,
    tenantId,
  })
  const entityId = uniqueEntityId('stale_save')
  const userIds: string[] = []
  let firstToken: string | null = null
  const initialMetadata = { label: 'Original label', description: 'Original description' }
  const draftMetadata = { label: 'Draft label', description: 'Draft description', showInSidebar: true }
  const originalField = { key: 'original', kind: 'text', configJson: { label: 'Original field' } }
  const draftField = { ...originalField, configJson: { label: 'Edited field' } }
  const secondField = { key: 'second_editor', kind: 'text' }

  async function createEditor() {
    const email = `entity-editor-${randomUUID()}@example.com`
    const password = `Test-${randomUUID()}!`
    const userId = await createUserFixture(request, superToken, { email, password, organizationId, roles: [] })
    userIds.push(userId)
    await setUserAclVisibility(request, superToken, {
      userId,
      organizations: [organizationId],
      features: ['entities.definitions.view', 'entities.definitions.manage'],
    })
    return withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, email, password))
  }

  async function readState(token: string) {
    const entityResponse = await listCustomEntities(request, token)
    expect(entityResponse.status()).toBe(200)
    const { items: entities } = await entityResponse.json() as {
      items: Array<{ entityId: string; label: string; description: string; showInSidebar: boolean; updatedAt: string }>
    }
    const metadata = entities.find((entity) => entity.entityId === entityId)
    if (!metadata) throw new Error('[internal] Missing custom entity fixture')

    const definitionsResponse = await listFieldDefinitions(request, token, entityId)
    expect(definitionsResponse.status()).toBe(200)
    const definitions = await definitionsResponse.json() as {
      items: Array<{ key: string; configJson: { label: string } }>
      version: string
    }
    expect(definitions.version).toBeTruthy()
    return { metadata, ...definitions }
  }

  function saveDraft(token: string, snapshot: Awaited<ReturnType<typeof readState>>, includeSecondField: boolean) {
    return apiRequest(request, 'POST', '/api/entities/definitions.batch', {
      token,
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: snapshot.version },
      data: {
        entityId,
        entityMetadata: { ...draftMetadata, expectedUpdatedAt: snapshot.metadata.updatedAt },
        definitions: includeSecondField ? [draftField, secondField] : [draftField],
      },
    })
  }

  try {
    firstToken = await createEditor()
    const secondToken = await createEditor()
    expect(firstToken === secondToken).toBe(false)
    expect(getTokenContext(firstToken).organizationId).toBe(organizationId)
    expect(getTokenContext(secondToken).organizationId).toBe(organizationId)

    expect((await createCustomEntity(request, firstToken, { entityId, ...initialMetadata })).status()).toBe(200)
    expect((await saveFieldDefinitions(request, firstToken, entityId, [originalField])).status()).toBe(200)
    const firstSnapshot = await readState(firstToken)

    expect((await saveFieldDefinitions(request, secondToken, entityId, [originalField, secondField])).status()).toBe(200)
    const rejected = await saveDraft(firstToken, firstSnapshot, false)
    expect(rejected.status()).toBe(409)
    expect(await rejected.json()).toMatchObject({ code: OPTIMISTIC_LOCK_CONFLICT_CODE })

    const reloaded = await readState(firstToken)
    expect(reloaded.metadata).toMatchObject({
      ...initialMetadata,
      showInSidebar: false,
      updatedAt: firstSnapshot.metadata.updatedAt,
    })
    expect(reloaded.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: originalField.key, configJson: expect.objectContaining(originalField.configJson) }),
      expect.objectContaining({ key: secondField.key }),
    ]))

    expect((await saveDraft(firstToken, reloaded, true)).status()).toBe(200)
    const saved = await readState(secondToken)
    expect(saved.metadata).toMatchObject(draftMetadata)
    expect(saved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: draftField.key, configJson: expect.objectContaining(draftField.configJson) }),
      expect.objectContaining({ key: secondField.key }),
    ]))
  } finally {
    if (firstToken) {
      for (const key of [originalField.key, secondField.key]) {
        await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token: firstToken,
          data: { entityId, key },
        }).catch(() => undefined)
      }
      await deleteCustomEntityIfExists(request, firstToken, entityId)
    }
    for (const userId of userIds) await deleteUserIfExists(request, superToken, userId)
    await deleteOrganizationIfExists(request, superToken, organizationId)
  }
})
