import { expect, type APIRequestContext, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['documents', 'customers', 'catalog', 'sales'] }

type Created = { id: string; updatedAt: string }
type Target = { entityType: string; entityId: string; label: string; href: string }

async function createDocument(request: APIRequestContext, token: string, title: string): Promise<Created> {
  const response = await apiRequest(request, 'POST', '/api/documents', { token, data: { title, folderId: null } })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status()).toBe(201)
  return { id: expectId(body?.id, 'document id'), updatedAt: expectId(body?.updatedAt, 'document updatedAt') }
}

async function createLink(request: APIRequestContext, token: string, documentId: string, target: Target): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/documents/${encodeURIComponent(documentId)}/links`, {
    token, data: { ...target, source: 'related-panel' },
  })
  expect([200, 201], `link ${target.entityType}`).toContain(response.status())
}

async function deleteDocument(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  const detail = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(id)}`, { token }).catch(() => null)
  const body = detail ? await readJsonSafe<{ updatedAt?: string }>(detail) : null
  await request.fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}`, ...(body?.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: body.updatedAt } : {}) },
  }).catch(() => undefined)
}

async function deleteTemplate(request: APIRequestContext, token: string | null, template: Created | null): Promise<void> {
  if (!token || !template) return
  await request.fetch('/api/documents/templates', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', [OPTIMISTIC_LOCK_HEADER_NAME]: template.updatedAt },
    data: { id: template.id },
  }).catch(() => undefined)
}

test.describe('TC-DOCUMENTS-014: UMES related documents across host records', () => {
  test('renders current and legacy hosts, links by title, and creates from hydrated context', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const linkedTitle = `TC-DOCUMENTS-014 linked ${stamp}`
    const searchableTitle = `TC-DOCUMENTS-014 searchable ${stamp}`
    const personLabel = `Related Person ${stamp}`
    let token: string | null = null
    let linkedDocument: Created | null = null
    let searchableDocument: Created | null = null
    let instantiatedDocumentId: string | null = null
    let template: Created | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null
    let productId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      linkedDocument = await createDocument(request, token, linkedTitle)
      searchableDocument = await createDocument(request, token, searchableTitle)
      companyId = await createCompanyFixture(request, token, `Related Company ${stamp}`)
      personId = await createPersonFixture(request, token, { firstName: 'Related', lastName: `Person ${stamp}`, displayName: personLabel, companyEntityId: companyId })
      dealId = await createDealFixture(request, token, { title: `Related Deal ${stamp}`, companyIds: [companyId], personIds: [personId] })
      productId = await createProductFixture(request, token, { title: `Related Product ${stamp}`, sku: `DOC14-${stamp}` })
      quoteId = await createSalesQuoteFixture(request, token)
      orderId = await createSalesOrderFixture(request, token)

      const targets: Target[] = [
        { entityType: 'customer-person', entityId: personId, label: personLabel, href: `/backend/customers/people/${personId}` },
        { entityType: 'customer-company', entityId: companyId, label: `Related Company ${stamp}`, href: `/backend/customers/companies/${companyId}` },
        { entityType: 'deal', entityId: dealId, label: `Related Deal ${stamp}`, href: `/backend/customers/deals/${dealId}` },
        { entityType: 'product', entityId: productId, label: `Related Product ${stamp}`, href: `/backend/catalog/products/${productId}` },
        { entityType: 'quote', entityId: quoteId, label: `Quote ${stamp}`, href: `/backend/sales/quotes/${quoteId}` },
        { entityType: 'sales-order', entityId: orderId, label: `Order ${stamp}`, href: `/backend/sales/orders/${orderId}` },
      ]
      for (const target of targets) await createLink(request, token, linkedDocument.id, target)

      const templateResponse = await apiRequest(request, 'POST', '/api/documents/templates', {
        token,
        data: {
          name: `TC-DOCUMENTS-014 Person brief ${stamp}`,
          description: 'Contextual person template',
          bodyHtml: '<h1>{{customer.name}}</h1><p>Context-ready brief</p>',
          contextSlots: [{ slot: 'customer', entityType: 'customer-person', required: true }],
          isActive: true,
        },
      })
      const templateBody = await readJsonSafe<{ id?: string; updatedAt?: string }>(templateResponse)
      expect(templateResponse.status()).toBe(201)
      template = { id: expectId(templateBody?.id, 'template id'), updatedAt: expectId(templateBody?.updatedAt, 'template updatedAt') }

      await login(page, 'admin')
      const routes = [
        `/backend/customers/people-v2/${personId}`,
        `/backend/customers/people/${personId}`,
        `/backend/customers/companies-v2/${companyId}`,
        `/backend/customers/companies/${companyId}`,
        `/backend/customers/deals/${dealId}`,
        `/backend/catalog/products/${productId}`,
        `/backend/sales/quotes/${quoteId}`,
        `/backend/sales/orders/${orderId}`,
      ]
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { name: 'Related documents' }).first(), `widget on ${route}`).toBeVisible({ timeout: 30_000 })
        const titleLink = page.getByRole('link', { name: linkedTitle }).first()
        await expect(titleLink).toBeVisible()
        await expect(titleLink).toHaveAttribute('href', `/backend/documents/${linkedDocument.id}`)
        await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
      }

      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Link existing' }).click()
      const linkDialog = page.getByRole('dialog', { name: 'Link existing document' })
      await linkDialog.getByLabel('Document title').fill(searchableTitle)
      const result = linkDialog.getByRole('button').filter({ hasText: searchableTitle }).first()
      await expect(result).toBeVisible({ timeout: 20_000 })
      const listResponse = await apiRequest(request, 'GET', `/api/documents?search=${encodeURIComponent(searchableTitle)}&page=1&pageSize=20`, { token })
      const listBody = await readJsonSafe<{ items?: Array<{ ownerLabel?: string }> }>(listResponse)
      const ownerLabel = listBody?.items?.[0]?.ownerLabel
      expect(ownerLabel && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(ownerLabel)).toBeTruthy()
      await expect(result).toContainText(ownerLabel!)
      await result.click()
      await expect(page.getByRole('link', { name: searchableTitle })).toBeVisible({ timeout: 20_000 })

      await page.getByRole('button', { name: 'New from template' }).click()
      const templateDialog = page.getByRole('dialog', { name: 'New from template' })
      await templateDialog.getByLabel('Search templates').fill(`TC-DOCUMENTS-014 Person brief ${stamp}`)
      // The template picker is a RadioGroup, so each entry exposes role="radio" — not
      // role="option", which only exists inside a listbox.
      await templateDialog.getByRole('radio', { name: new RegExp(`TC-DOCUMENTS-014 Person brief ${stamp}`) }).click()
      await expect(templateDialog.getByText(personLabel)).toBeVisible({ timeout: 20_000 })
      await expect(templateDialog.getByText('Context-ready brief')).toBeVisible({ timeout: 20_000 })
      await templateDialog.getByLabel('Document title').fill(`TC-DOCUMENTS-014 instantiated ${stamp}`)
      await templateDialog.getByRole('button', { name: 'Create document' }).click()
      await page.waitForURL(/\/backend\/documents\/[0-9a-f-]{36}$/i, { timeout: 30_000 })
      instantiatedDocumentId = page.url().match(/\/backend\/documents\/([0-9a-f-]{36})$/i)?.[1] ?? null
      expect(instantiatedDocumentId).toBeTruthy()

      await page.route('**/api/documents?entityType=*', async (route) => {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) })
      })
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`/backend/customers/people-v2/${personId}$`))
      await expect(page.getByRole('heading', { name: 'Related documents' })).toHaveCount(0)
      await page.unroute('**/api/documents?entityType=*')
    } finally {
      await deleteDocument(request, token, instantiatedDocumentId)
      await deleteDocument(request, token, searchableDocument?.id ?? null)
      await deleteDocument(request, token, linkedDocument?.id ?? null)
      await deleteTemplate(request, token, template)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
