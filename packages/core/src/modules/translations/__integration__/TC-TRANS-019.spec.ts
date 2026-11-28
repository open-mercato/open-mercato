import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  saveFieldDefinitions,
  uniqueEntityId,
} from '@open-mercato/core/modules/entities/__integration__/helpers/entitiesApi'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

export const integrationMeta = { dependsOnModules: ['translations', 'entities'] }

const RESOURCE_ENTITY_TYPE = 'resources:resources_resource'
const RESOURCES_API = '/api/resources/resources'
const PRODUCT_ENTITY_TYPE = 'catalog:catalog_product'
const FIELD_DEFINITION_ENTITY_TYPE = 'entities:custom_field_def'

type TranslationsBody = { translations?: Record<string, Record<string, string>> }

function readUndoToken(response: APIResponse): string {
  const header = response.headers()['x-om-operation'] ?? ''
  const encoded = header.startsWith('omop:') ? header.slice(5) : ''
  expect(encoded, 'x-om-operation header carries an omop: payload').not.toBe('')
  const payload = JSON.parse(decodeURIComponent(encoded)) as { undoToken?: string }
  expect(typeof payload.undoToken, 'undoToken present').toBe('string')
  return payload.undoToken as string
}

async function readTranslations(
  request: APIRequestContext,
  token: string,
  entityType: string,
  entityId: string,
): Promise<{ status: number; body: TranslationsBody }> {
  const response = await apiRequest(request, 'GET', `/api/translations/${entityType}/${entityId}`, { token })
  const body = response.ok() ? ((await response.json()) as TranslationsBody) : {}
  return { status: response.status(), body }
}

async function isResourceListed(request: APIRequestContext, token: string, resourceId: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `${RESOURCES_API}?ids=${encodeURIComponent(resourceId)}`, { token })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  return (body.items ?? []).some((item) => item.id === resourceId)
}

/**
 * TC-TRANS-019: Entity translations survive a soft delete so undo restores them
 * Covers DELETE /api/resources/resources (soft delete) + POST /api/audit_logs/audit-logs/actions/undo,
 * and DELETE /api/catalog/products (hard delete) against GET /api/translations/:entityType/:entityId,
 * which hides the kept translations while the owning record is soft-deleted.
 */
test.describe('TC-TRANS-019: Entity translations survive a soft delete so undo restores them', () => {
  test('undoing a resource delete restores the resource together with its translations', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8)
    let token: string | null = null
    let resourceId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const createResponse = await apiRequest(request, 'POST', RESOURCES_API, {
        token,
        data: { name: `QA TC-TRANS-019 Resource ${stamp}` },
      })
      expect(createResponse.status(), 'resource create 201').toBe(201)
      resourceId = ((await createResponse.json()) as { id: string }).id
      expect(resourceId, 'resource id returned').toBeTruthy()

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${RESOURCE_ENTITY_TYPE}/${resourceId}`, {
        token,
        data: { de: { name: `Ressource ${stamp}`, description: 'Beschreibung' } },
      })
      expect(putResponse.ok(), `translation upsert failed: ${putResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(request, 'DELETE', `${RESOURCES_API}?id=${encodeURIComponent(resourceId)}`, { token })
      expect(deleteResponse.status(), 'resource delete 200').toBe(200)
      const undoToken = readUndoToken(deleteResponse)
      expect(await isResourceListed(request, token, resourceId), 'resource hidden after delete').toBe(false)

      const afterDelete = await readTranslations(request, token, RESOURCE_ENTITY_TYPE, resourceId)
      expect(afterDelete.status, 'translations of a soft-deleted resource are not readable').toBe(404)

      const undoResponse = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token,
        data: { undoToken },
      })
      expect(undoResponse.status(), 'undo 200').toBe(200)
      expect(await isResourceListed(request, token, resourceId), 'resource listed again after undo').toBe(true)

      const afterUndo = await readTranslations(request, token, RESOURCE_ENTITY_TYPE, resourceId)
      expect(afterUndo.status, 'translations readable after undo').toBe(200)
      expect(afterUndo.body.translations?.de?.name).toBe(`Ressource ${stamp}`)
      expect(afterUndo.body.translations?.de?.description).toBe('Beschreibung')
    } finally {
      await deleteTranslationIfExists(request, token, RESOURCE_ENTITY_TYPE, resourceId)
      if (token && resourceId) {
        await apiRequest(request, 'DELETE', `${RESOURCES_API}?id=${encodeURIComponent(resourceId)}`, { token }).catch(() => undefined)
      }
    }
  })

  test('a hard delete still removes the record translations', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8)
    let token: string | null = null
    let productId: string | null = null
    let translatedProductId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      productId = await createProductFixture(request, token, {
        title: `QA TC-TRANS-019 Product ${stamp}`,
        sku: `QA-TRANS-019-${stamp}`,
      })
      translatedProductId = productId

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${PRODUCT_ENTITY_TYPE}/${productId}`, {
        token,
        data: { de: { title: `Produkt ${stamp}` } },
      })
      expect(putResponse.ok(), `translation upsert failed: ${putResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'product delete 200').toBe(200)

      const afterDelete = await readTranslations(request, token, PRODUCT_ENTITY_TYPE, productId)
      expect(afterDelete.status, 'translations removed with the hard-deleted product').toBe(404)
      productId = null
    } finally {
      await deleteTranslationIfExists(request, token, PRODUCT_ENTITY_TYPE, translatedProductId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('restoring a soft-deleted field definition restores its translations', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8)
    const entityId = uniqueEntityId('trans_019_fields')
    const fieldKey = 'status'
    const recordId = `${entityId}:${fieldKey}`
    let token: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      expect((await createCustomEntity(request, token, { entityId, label: 'TC-TRANS-019 field def' })).status()).toBe(200)
      expect((await saveFieldDefinitions(request, token, entityId, [{
        key: fieldKey,
        kind: 'text',
        configJson: { label: `Status ${stamp}` },
      }])).status()).toBe(200)

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${FIELD_DEFINITION_ENTITY_TYPE}/${recordId}`, {
        token,
        data: { de: { label: `Statusbezeichnung ${stamp}` } },
      })
      expect(putResponse.ok(), `translation upsert failed: ${putResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
        token,
        data: { entityId, key: fieldKey },
      })
      expect(deleteResponse.status(), 'field definition delete 200').toBe(200)

      const afterDelete = await readTranslations(request, token, FIELD_DEFINITION_ENTITY_TYPE, recordId)
      expect(afterDelete.status, 'translations of a soft-deleted field definition are not readable').toBe(404)

      const restoreResponse = await apiRequest(request, 'POST', '/api/entities/definitions.restore', {
        token,
        data: { entityId, key: fieldKey },
      })
      expect(restoreResponse.status(), 'field definition restore 200').toBe(200)

      const afterRestore = await readTranslations(request, token, FIELD_DEFINITION_ENTITY_TYPE, recordId)
      expect(afterRestore.status, 'translations readable after restore').toBe(200)
      expect(afterRestore.body.translations?.de?.label).toBe(`Statusbezeichnung ${stamp}`)
    } finally {
      await deleteTranslationIfExists(request, token, FIELD_DEFINITION_ENTITY_TYPE, recordId)
      if (token) {
        await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key: fieldKey } }).catch(() => undefined)
      }
      await deleteCustomEntityIfExists(request, token, entityId)
    }
  })

  test('a field-definition translation in one organization stays readable while another organization\'s same logical field is soft-deleted', async ({ request }) => {
    const entityId = uniqueEntityId('trans_019_two_orgs')
    const fieldKey = 'status'
    const recordId = `${entityId}:${fieldKey}`
    const administrator = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(administrator)
    const organizations: string[] = []
    const users: string[] = []
    const orgTokens: string[] = []
    let roleId: string | null = null

    try {
      for (const name of ['Alpha', 'Beta']) {
        organizations.push(await createOrganizationFixture(request, administrator, { name: `TC-TRANS-019 ${name} ${randomUUID()}`, tenantId }))
      }
      roleId = await createRoleFixture(request, administrator, { name: `trans-019-two-orgs-${randomUUID()}`, tenantId })
      await setRoleAclFeatures(request, administrator, {
        roleId,
        organizations,
        features: ['entities.definitions.view', 'entities.definitions.manage', 'translations.view', 'translations.manage'],
      })

      for (const organizationId of organizations) {
        const email = `trans-019-two-orgs-${randomUUID()}@example.test`
        const password = `Test-${randomUUID()}!`
        users.push(await createUserFixture(request, administrator, { email, password, organizationId, roles: [roleId] }))
        orgTokens.push(await getAuthToken(request, email, password))
      }
      const [tokenAlpha, tokenBeta] = orgTokens

      for (const [index, orgToken] of orgTokens.entries()) {
        expect((await createCustomEntity(request, orgToken, { entityId, label: 'TC-TRANS-019 two-org field def' })).status(), `org ${index} entity create 200`).toBe(200)
        expect((await saveFieldDefinitions(request, orgToken, entityId, [{
          key: fieldKey,
          kind: 'text',
          configJson: { label: `Status ${index}` },
        }])).status(), `org ${index} field definition create 200`).toBe(200)
        const putResponse = await apiRequest(request, 'PUT', `/api/translations/${FIELD_DEFINITION_ENTITY_TYPE}/${recordId}`, {
          token: orgToken,
          data: { de: { label: `Statusbezeichnung Org ${index}` } },
        })
        expect(putResponse.ok(), `org ${index} translation upsert failed: ${putResponse.status()}`).toBeTruthy()
      }

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
        token: tokenAlpha,
        data: { entityId, key: fieldKey },
      })
      expect(deleteResponse.status(), 'org alpha field definition delete 200').toBe(200)

      const alphaAfterDelete = await readTranslations(request, tokenAlpha, FIELD_DEFINITION_ENTITY_TYPE, recordId)
      expect(alphaAfterDelete.status, 'org alpha translations hidden after its own soft delete').toBe(404)

      const betaAfterAlphaDelete = await readTranslations(request, tokenBeta, FIELD_DEFINITION_ENTITY_TYPE, recordId)
      expect(betaAfterAlphaDelete.status, 'org beta translations stay readable despite org alpha\'s deleted field definition').toBe(200)
      expect(betaAfterAlphaDelete.body.translations?.de?.label).toBe('Statusbezeichnung Org 1')
    } finally {
      for (const orgToken of orgTokens) {
        await deleteTranslationIfExists(request, orgToken, FIELD_DEFINITION_ENTITY_TYPE, recordId)
        await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: orgToken, data: { entityId, key: fieldKey } }).catch(() => undefined)
        await deleteCustomEntityIfExists(request, orgToken, entityId)
      }
      await Promise.all(users.map((userId) => deleteUserIfExists(request, administrator, userId)))
      await deleteRoleIfExists(request, administrator, roleId)
      await Promise.all(organizations.map((organizationId) => deleteOrganizationIfExists(request, administrator, organizationId)))
    }
  })
})
