import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('a person editor can resolve product relation options with catalog view permission', async ({ request, page, baseURL }, testInfo) => {
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenScope(adminToken)
  const marker = randomUUID()
  const email = `relation-editor-${marker}@example.test`
  const password = `Qa1!-${randomUUID()}`
  const title = `Relation product ${marker}`
  const fieldKey = `qa_product_${marker.replaceAll('-', '')}`
  const entityId = 'customers:customer_person_profile'
  const definition = { entityId, key: fieldKey }
  const editorFeatures = ['customers.people.view', 'customers.people.manage']
  let roleId: string | null = null
  let userId: string | null = null
  let productId: string | null = null
  let otherOrganizationId: string | null = null
  let otherProductId: string | null = null
  let personId: string | null = null
  let definitionCreated = false

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `relation-editor-${marker}`, tenantId })
    await setRoleAclFeatures(request, adminToken, { roleId, features: [...editorFeatures, 'catalog.products.view'] })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    productId = await createProductFixture(request, adminToken, { title, sku: `qa-${marker}` })
    otherOrganizationId = await createOrganizationFixture(request, superadminToken, {
      name: `Relation scope ${marker}`,
      tenantId,
    })
    const otherProduct = await apiRequestWithSelectedOrg(request, 'POST', '/api/catalog/products', {
      token: superadminToken,
      selectedOrgId: otherOrganizationId,
      data: {
        title,
        sku: `qa-other-${marker}`,
        description: 'Product in a separate organization for the relation options scope check.',
      },
    })
    expect(otherProduct.status()).toBe(201)
    otherProductId = expectId((await readJsonSafe<{ id?: string }>(otherProduct))?.id, 'Product in the other organization should have an ID')
    const token = await getAuthToken(request, email, password)
    const optionsUrl = '/api/entities/relations/options'
    const lookups = [
      new URLSearchParams({ entityId: 'catalog:catalog_product', q: title }),
      new URLSearchParams({ entityId: 'catalog:catalog_product', ids: productId }),
      new URLSearchParams({ entityId: 'catalog:catalog_product', ids: `${productId},${otherProductId}` }),
    ]

    for (const query of lookups) {
      const response = await apiRequest(request, 'GET', `${optionsUrl}?${query}`, { token })
      expect(response.status()).toBe(200)
      expect(await readJsonSafe(response)).toEqual({ items: [{ value: productId, label: title }] })
    }
    const idLabelSearch = new URLSearchParams(lookups[2])
    idLabelSearch.set('labelField', 'id')
    idLabelSearch.set('q', title)
    const idLabelResponse = await apiRequest(request, 'GET', `${optionsUrl}?${idLabelSearch}`, { token })
    expect(idLabelResponse.status()).toBe(200)
    expect(await readJsonSafe(idLabelResponse)).toEqual({ items: [{ value: productId, label: productId }] })

    const fieldResponse = await apiRequest(request, 'POST', '/api/entities/definitions', {
      token: adminToken,
      data: {
        ...definition,
        kind: 'relation',
        configJson: {
          label: 'QA related product',
          relatedEntityId: 'catalog:catalog_product',
          optionsUrl: new URL(`${optionsUrl}?entityId=catalog%3Acatalog_product`, baseURL).toString(),
        },
      },
    })
    expect(fieldResponse.ok(), `Relation definition creation returned ${fieldResponse.status()}`).toBeTruthy()
    definitionCreated = true
    const person = await apiRequest(request, 'POST', '/api/customers/people', {
      token: adminToken,
      data: {
        firstName: 'Relation',
        lastName: 'Editor',
        displayName: `Person ${marker}`,
        customFields: { [fieldKey]: productId },
      },
    })
    expect(person.ok()).toBeTruthy()
    personId = (await readJsonSafe<{ id: string }>(person))?.id ?? null
    expect(personId).toBeTruthy()
    expect(baseURL).toBeTruthy()
    await page.context().addCookies([{ name: 'auth_token', value: token, url: baseURL! }])
    await page.goto(`/backend/customers/people/${personId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(title, { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('person-product-label.png') })
    await page.getByText(title, { exact: true }).click()
    const relationInput = page.locator(`[data-crud-field-id="cf_${fieldKey}"]`).getByRole('combobox')
    await expect(relationInput).toBeEnabled()
    await expect(relationInput).toContainText(title)
    await page.screenshot({ path: testInfo.outputPath('person-product-picker.png') })

    const otherTarget = await apiRequest(request, 'GET', `${optionsUrl}?entityId=auth%3Arole`, { token })
    expect(otherTarget.status()).toBe(403)

    await setRoleAclFeatures(request, adminToken, { roleId, features: editorFeatures })
    const denied = await apiRequest(request, 'GET', `${optionsUrl}?${lookups[1]}`, { token })
    expect(denied.status()).toBe(403)
  } finally {
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    if (definitionCreated) {
      const cleanup = await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: adminToken, data: definition })
      expect([200, 404]).toContain(cleanup.status())
    }
    await deleteCatalogProductIfExists(request, adminToken, productId)
    if (otherOrganizationId && otherProductId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `/api/catalog/products?id=${otherProductId}`, {
        token: superadminToken,
        selectedOrgId: otherOrganizationId,
      }).catch(() => undefined)
    }
    await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
