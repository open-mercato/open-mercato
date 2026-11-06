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

type HostKind = 'person' | 'company' | 'deal' | 'product' | 'quote' | 'order'

const hosts: Array<{ kind: HostKind; entityType: string; path: string }> = [
  { kind: 'person', entityType: 'customer-person', path: '/backend/customers/people-v2' },
  { kind: 'person', entityType: 'customer-person', path: '/backend/customers/people' },
  { kind: 'company', entityType: 'customer-company', path: '/backend/customers/companies-v2' },
  { kind: 'company', entityType: 'customer-company', path: '/backend/customers/companies' },
  { kind: 'deal', entityType: 'deal', path: '/backend/customers/deals' },
  { kind: 'product', entityType: 'product', path: '/backend/catalog/products' },
  { kind: 'quote', entityType: 'quote', path: '/backend/sales/quotes' },
  { kind: 'order', entityType: 'sales-order', path: '/backend/sales/orders' },
]

async function createHost(request: APIRequestContext, token: string, kind: HostKind, stamp: number): Promise<string> {
  switch (kind) {
    case 'person': return createPersonFixture(request, token, { firstName: 'Related', lastName: `Person ${stamp}`, displayName: `Related Person ${stamp}` })
    case 'company': return createCompanyFixture(request, token, `Related Company ${stamp}`)
    case 'deal': return createDealFixture(request, token, { title: `Related Deal ${stamp}` })
    case 'product': return createProductFixture(request, token, { title: `Related Product ${stamp}`, sku: `DOC14-${stamp}` })
    case 'quote': return createSalesQuoteFixture(request, token)
    case 'order': return createSalesOrderFixture(request, token)
  }
}

async function deleteHost(request: APIRequestContext, token: string | null, kind: HostKind, id: string | null): Promise<void> {
  switch (kind) {
    case 'person': return deleteEntityIfExists(request, token, '/api/customers/people', id)
    case 'company': return deleteEntityIfExists(request, token, '/api/customers/companies', id)
    case 'deal': return deleteEntityIfExists(request, token, '/api/customers/deals', id)
    case 'product': return deleteCatalogProductIfExists(request, token, id)
    case 'quote': return deleteSalesEntityIfExists(request, token, '/api/sales/quotes', id)
    case 'order': return deleteSalesEntityIfExists(request, token, '/api/sales/orders', id)
  }
}

test.describe('TC-DOCUMENTS-014: UMES related documents across host records', () => {
  for (const host of hosts) {
    test(`renders the related document on ${host.path}`, async ({ page, request }) => {
      const stamp = Date.now()
      const title = `TC-DOCUMENTS-014 linked ${stamp}`
      let token: string | null = null
      let document: Created | null = null
      let hostId: string | null = null
      try {
        token = await getAuthToken(request, 'admin')
        document = await createDocument(request, token, title)
        hostId = await createHost(request, token, host.kind, stamp)
        const href = `${host.path}/${hostId}`
        await createLink(request, token, document.id, { entityType: host.entityType, entityId: hostId, label: `Related ${host.kind} ${stamp}`, href: `${host.path.replace(/-v2$/, '')}/${hostId}` })
        await login(page, 'admin')
        await page.goto(href, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { name: 'Related documents' }).first(), `widget on ${href}`).toBeVisible()
        const titleLink = page.getByRole('link', { name: title }).first()
        await expect(titleLink).toBeVisible()
        await expect(titleLink).toHaveAttribute('href', `/backend/documents/${document.id}`)
        await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
      } finally {
        await deleteDocument(request, token, document?.id ?? null)
        await deleteHost(request, token, host.kind, hostId)
      }
    })
  }

  test('links an existing document by title and displays its owner', async ({ page, request }) => {
    const stamp = Date.now()
    const title = `TC-DOCUMENTS-014 searchable ${stamp}`
    let token: string | null = null
    let document: Created | null = null
    let personId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      document = await createDocument(request, token, title)
      personId = await createHost(request, token, 'person', stamp)
      await login(page, 'admin')
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Related documents' })).toBeVisible()
      await page.getByRole('button', { name: 'Link existing' }).click()
      await expect(page.getByRole('link', { name: title })).toHaveCount(0)
      const linkDialog = page.getByRole('dialog', { name: 'Link existing document' })
      await linkDialog.getByLabel('Document title').fill(title)
      const result = linkDialog.getByRole('button').filter({ hasText: title }).first()
      await expect(result).toBeVisible()
      const listResponse = await apiRequest(request, 'GET', `/api/documents?search=${encodeURIComponent(title)}&page=1&pageSize=20`, { token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string; ownerLabel?: string }> }>(listResponse)
      const item = listBody?.items?.find((entry) => entry.id === document?.id)
      expect(item).toBeDefined()
      const ownerLabel = item?.ownerLabel
      expect(ownerLabel && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(ownerLabel)).toBeTruthy()
      await expect(result).toContainText(ownerLabel!)
      await result.click()
      await expect(page.getByRole('link', { name: title })).toBeVisible()
    } finally {
      await deleteDocument(request, token, document?.id ?? null)
      await deleteHost(request, token, 'person', personId)
    }
  })

  test('creates a document from a template with hydrated person context', async ({ page, request }) => {
    const stamp = Date.now()
    const personLabel = `Related Person ${stamp}`
    const templateName = `TC-DOCUMENTS-014 Person brief ${stamp}`
    let token: string | null = null
    let personId: string | null = null
    let documentId: string | null = null
    let template: Created | null = null
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createHost(request, token, 'person', stamp)
      const templateResponse = await apiRequest(request, 'POST', '/api/documents/templates', {
        token,
        data: {
          name: templateName,
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
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'New from template' }).click()
      const templateDialog = page.getByRole('dialog', { name: 'New from template' })
      await templateDialog.getByLabel('Search templates').fill(templateName)
      await templateDialog.getByRole('radio', { name: new RegExp(templateName) }).click()
      await expect(templateDialog.getByText(personLabel)).toBeVisible()
      await expect(templateDialog.getByText('Context-ready brief')).toBeVisible()
      await templateDialog.getByLabel('Document title').fill(`TC-DOCUMENTS-014 instantiated ${stamp}`)
      await templateDialog.getByRole('button', { name: 'Create document' }).click()
      await page.waitForURL(/\/backend\/documents\/[0-9a-f-]{36}$/i)
      documentId = page.url().match(/\/backend\/documents\/([0-9a-f-]{36})$/i)?.[1] ?? null
      expect(documentId).toBeTruthy()
    } finally {
      await deleteDocument(request, token, documentId)
      await deleteTemplate(request, token, template)
      await deleteHost(request, token, 'person', personId)
    }
  })

  test('hides the card after a forbidden related-documents response on a loaded host', async ({ page, request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let personId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createHost(request, token, 'person', stamp)
      await login(page, 'admin')
      const href = `/backend/customers/people-v2/${personId}`
      await page.goto(href, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Link existing' })).toBeVisible()
      const relatedUrl = `**/api/documents?entityType=customer-person&entityId=${personId}&*`
      await page.route(relatedUrl, async (route) => {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) })
      })
      try {
        const deniedResponse = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.pathname === '/api/documents' && url.searchParams.get('entityId') === personId && response.status() === 403
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await deniedResponse
        await expect(page.getByRole('heading', { name: `Related Person ${stamp}`, exact: true })).toBeVisible()
        await expect(page).toHaveURL(new RegExp(`${href}$`))
        await expect(page.getByRole('heading', { name: 'Related documents' })).toHaveCount(0)
      } finally {
        await page.unroute(relatedUrl)
      }
    } finally {
      await deleteHost(request, token, 'person', personId)
    }
  })
})
