import { expect, type APIRequestContext, type Page, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  getEntityRegistryEntry,
  readItemsArray,
  type DocumentEntityType,
} from '../lib/entityRegistry'

export const integrationMeta = {
  dependsOnModules: ['documents', 'customers', 'catalog', 'sales'],
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

type Created = { id: string; updatedAt: string }
type Preview = {
  contentHtml?: string
  unresolvedTokens?: string[]
  previewDigest?: string
  templateUpdatedAt?: string
}
type RegistryTarget = {
  entityType: DocumentEntityType
  entityId: string
  label: string
  href: string
  values: Record<string, string | null>
  searchPath: string
  tabLabel: string
}

const TAB_LABELS: Record<DocumentEntityType, string> = {
  'customer-person': 'Customer',
  'customer-company': 'Company',
  deal: 'Deal',
  product: 'Product',
  'catalog-offer': 'Catalog offer',
  document: 'Document',
  quote: 'Quote',
  'sales-order': 'Sales order',
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function createDocument(request: APIRequestContext, token: string, title: string): Promise<Created> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status()).toBe(201)
  return {
    id: expectId(body?.id, 'document id'),
    updatedAt: expectId(body?.updatedAt, 'document updatedAt'),
  }
}

async function createChannel(request: APIRequestContext, token: string, stamp: number): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/channels', {
    token,
    data: { name: `Documents picker channel ${stamp}`, code: `documents-picker-${stamp}` },
  })
  const body = await readJsonSafe<{ id?: string; channelId?: string }>(response)
  expect(response.status()).toBe(201)
  return expectId(body?.id ?? body?.channelId, 'channel id')
}

async function createOffer(
  request: APIRequestContext,
  token: string,
  input: { title: string; productId: string; channelId: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/offers', { token, data: input })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status()).toBe(201)
  return expectId(body?.id, 'catalog offer id')
}

async function createTemplate(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<Created> {
  const response = await apiRequest(request, 'POST', '/api/documents/templates', {
    token,
    data: {
      name: `TC-DOCUMENTS-016 commercial summary ${stamp}`,
      description: 'Product, offer, quote, and order acceptance fixture',
      bodyHtml: [
        '<h1>{{product.title}}</h1>',
        '<p>{{offer.title}}</p>',
        '<p>{{quote.number}}</p>',
        '<p>{{order.number}}</p>',
        '<p>{{product.chip}} {{offer.chip}} {{quote.chip}} {{order.chip}}</p>',
      ].join(''),
      contextSlots: [
        { slot: 'product', entityType: 'product', required: true },
        { slot: 'offer', entityType: 'catalog-offer', required: true },
        { slot: 'quote', entityType: 'quote', required: true },
        { slot: 'order', entityType: 'sales-order', required: true },
      ],
      isActive: true,
    },
  })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status()).toBe(201)
  return {
    id: expectId(body?.id, 'template id'),
    updatedAt: expectId(body?.updatedAt, 'template updatedAt'),
  }
}

async function resolveRegistryTarget(
  request: APIRequestContext,
  token: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<RegistryTarget> {
  const entry = getEntityRegistryEntry(entityType)
  expect(entry, `registry entry ${entityType}`).not.toBeNull()
  const response = await apiRequest(
    request,
    'GET',
    `${entry!.searchPath}?id=${encodeURIComponent(entityId)}&page=1&pageSize=1`,
    { token },
  )
  const payload = await readJsonSafe<unknown>(response)
  expect(response.status(), `registry lookup ${entityType}`).toBe(200)
  const rawItem = readItemsArray(payload).find((item) => entry!.mapItem(item)?.id === entityId)
  const item = rawItem ? entry!.mapItem(rawItem) : null
  const href = item ? entry!.resolveHref(item) : null
  expect(item, `mapped registry item ${entityType}`).not.toBeNull()
  expect(href, `canonical registry href ${entityType}`).toBeTruthy()
  expect(item!.label).not.toMatch(UUID_PATTERN)
  return {
    entityType,
    entityId,
    label: item!.label,
    href: href!,
    values: Object.fromEntries(entry!.tokenFields.map((field) => [field.field, field.extract(rawItem!)])),
    searchPath: entry!.searchPath,
    tabLabel: TAB_LABELS[entityType],
  }
}

async function expectNoGuidInReadableSurface(page: Page): Promise<void> {
  const readable = await page.locator('body').evaluate((body) => {
    const visible = (element: Element): boolean => {
      const html = element as HTMLElement
      const style = html.ownerDocument.defaultView?.getComputedStyle(html)
      return Boolean(style && style.visibility !== 'hidden' && style.display !== 'none' && html.getClientRects().length > 0)
    }
    const nodes = Array.from(body.querySelectorAll('*')).filter(visible)
    const described = nodes.flatMap((node) => (
      (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        .map((id) => body.ownerDocument.getElementById(id)?.textContent ?? '')
    ))
    return [
      (body as HTMLElement).innerText,
      ...nodes.map((node) => node.getAttribute('aria-label') ?? ''),
      ...nodes.map((node) => node.getAttribute('aria-description') ?? ''),
      ...nodes.map((node) => node.getAttribute('title') ?? ''),
      ...nodes.filter((node) => node instanceof HTMLImageElement).map((node) => (node as HTMLImageElement).alt),
      ...nodes.filter((node) => node instanceof HTMLInputElement).flatMap((node) => [
        (node as HTMLInputElement).value,
        (node as HTMLInputElement).placeholder,
      ]),
      ...described,
    ].join('\n')
  })
  expect(readable).not.toMatch(UUID_PATTERN)
}

async function selectTargetThroughLivePicker(
  page: Page,
  documentId: string,
  target: RegistryTarget,
): Promise<void> {
  const panel = page.getByRole('heading', { name: 'Related records' }).locator('xpath=ancestor::section')
  await panel.getByRole('button', { name: 'Link record' }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert record' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: target.tabLabel }).click()
  const search = dialog.getByRole('combobox', { name: 'Search' })
  const peerResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === target.searchPath && url.searchParams.get('search') === target.label
  })
  await search.fill(target.label)
  expect((await peerResponse).status(), `live picker peer search ${target.entityType}`).toBe(200)
  const option = dialog.getByRole('option', { name: new RegExp(escapeRegExp(target.label)) }).first()
  await expect(option).toBeVisible()
  expect(await dialog.innerText()).not.toMatch(UUID_PATTERN)
  const linkResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/documents/${documentId}/links`
  ))
  await search.press('Enter')
  expect([200, 201], `link response ${target.entityType}`).toContain((await linkResponse).status())
  await expect(panel.getByText(target.label, { exact: true })).toBeVisible()
  await expectNoGuidInReadableSurface(page)
}

async function deleteDocument(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  const detail = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(id)}`, { token }).catch(() => null)
  const body = detail ? await readJsonSafe<{ updatedAt?: string }>(detail) : null
  await request.fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body?.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: body.updatedAt } : {}),
    },
  }).catch(() => undefined)
}

async function deleteTemplate(request: APIRequestContext, token: string | null, template: Created | null): Promise<void> {
  if (!token || !template) return
  await request.fetch('/api/documents/templates', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: template.updatedAt,
    },
    data: { id: template.id },
  }).catch(() => undefined)
}

test.describe('TC-DOCUMENTS-016: label-first ecosystem selectors and commercial templates', () => {
  test('selects and links all seven registry peer types through the live label-first picker', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let pickerDocument: Created | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null
    let productId: string | null = null
    let channelId: string | null = null
    let offerId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      pickerDocument = await createDocument(request, token, `TC-DOCUMENTS-016 picker ${stamp}`)
      companyId = await createCompanyFixture(request, token, `Documents selector company ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'Documents',
        lastName: `Selector ${stamp}`,
        displayName: `Documents selector person ${stamp}`,
        companyEntityId: companyId,
      })
      dealId = await createDealFixture(request, token, {
        title: `Documents selector deal ${stamp}`,
        companyIds: [companyId],
        personIds: [personId],
      })
      productId = await createProductFixture(request, token, {
        title: `Documents selector product ${stamp}`,
        sku: `DOC16-${stamp}`,
      })
      channelId = await createChannel(request, token, stamp)
      offerId = await createOffer(request, token, {
        title: `Documents selector offer ${stamp}`,
        productId,
        channelId,
      })
      quoteId = await createSalesQuoteFixture(request, token)
      orderId = await createSalesOrderFixture(request, token)

      const targets = await Promise.all([
        resolveRegistryTarget(request, token, 'customer-person', personId),
        resolveRegistryTarget(request, token, 'customer-company', companyId),
        resolveRegistryTarget(request, token, 'deal', dealId),
        resolveRegistryTarget(request, token, 'product', productId),
        resolveRegistryTarget(request, token, 'catalog-offer', offerId),
        resolveRegistryTarget(request, token, 'quote', quoteId),
        resolveRegistryTarget(request, token, 'sales-order', orderId),
      ])
      const product = targets.find((target) => target.entityType === 'product')!
      const offer = targets.find((target) => target.entityType === 'catalog-offer')!
      expect(offer.href, 'offers canonically open their owning product').toBe(product.href)

      await login(page, 'admin')
      await page.goto(`/backend/documents/${pickerDocument.id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Related records' })).toBeVisible()
      for (const target of targets) {
        await selectTargetThroughLivePicker(page, pickerDocument.id, target)
      }

      const linksResponse = await apiRequest(request, 'GET', `/api/documents/${pickerDocument.id}/links`, { token })
      const linksBody = await readJsonSafe<{ items?: Array<{ entityType?: string; entityId?: string; label?: string; href?: string }> }>(linksResponse)
      expect(linksResponse.status()).toBe(200)
      for (const target of targets) {
        expect(linksBody?.items).toContainEqual(expect.objectContaining({
          entityType: target.entityType,
          entityId: target.entityId,
          label: target.label,
          href: target.href,
        }))
      }
      expect(linksBody?.items?.find((item) => item.entityType === 'catalog-offer')?.href).toBe(product.href)

      await page.route('**/api/catalog/offers?**', async (route) => {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) })
      })
      const panel = page.getByRole('heading', { name: 'Related records' }).locator('xpath=ancestor::section')
      await panel.getByRole('button', { name: 'Link record' }).click()
      let dialog = page.getByRole('dialog', { name: 'Insert record' })
      await dialog.getByRole('radio', { name: 'Catalog offer' }).click()
      await dialog.getByRole('combobox', { name: 'Search' }).fill(`Forbidden ${stamp}`)
      await expect(dialog.getByRole('radio', { name: 'Catalog offer' })).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`/backend/documents/${pickerDocument.id}$`))
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await page.unroute('**/api/catalog/offers?**')

      await page.route('**/api/sales/quotes?**', async (route) => {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) })
      })
      await panel.getByRole('button', { name: 'Link record' }).click()
      dialog = page.getByRole('dialog', { name: 'Insert record' })
      await dialog.getByRole('radio', { name: 'Quote' }).click()
      await dialog.getByRole('combobox', { name: 'Search' }).fill(`Missing ${stamp}`)
      await expect(dialog.getByRole('radio', { name: 'Quote' })).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`/backend/documents/${pickerDocument.id}$`))
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await page.unroute('**/api/sales/quotes?**')
    } finally {
      await page.unroute('**/api/catalog/offers?**').catch(() => undefined)
      await page.unroute('**/api/sales/quotes?**').catch(() => undefined)
      await deleteDocument(request, token, pickerDocument?.id ?? null)
      if (token && offerId) await apiRequest(request, 'DELETE', `/api/catalog/offers?id=${encodeURIComponent(offerId)}`, { token }).catch(() => undefined)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
      if (token && channelId) await apiRequest(request, 'DELETE', `/api/sales/channels?id=${encodeURIComponent(channelId)}`, { token }).catch(() => undefined)
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('previews, instantiates, and persists product, offer, quote, and order template data', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let instantiatedDocumentId: string | null = null
    let template: Created | null = null
    let productId: string | null = null
    let channelId: string | null = null
    let offerId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      productId = await createProductFixture(request, token, {
        title: `Documents template product ${stamp}`,
        sku: `DOC16-TPL-${stamp}`,
      })
      channelId = await createChannel(request, token, stamp)
      offerId = await createOffer(request, token, {
        title: `Documents template offer ${stamp}`,
        productId,
        channelId,
      })
      quoteId = await createSalesQuoteFixture(request, token)
      orderId = await createSalesOrderFixture(request, token)
      template = await createTemplate(request, token, stamp)

      const [product, offer, quote, order] = await Promise.all([
        resolveRegistryTarget(request, token, 'product', productId),
        resolveRegistryTarget(request, token, 'catalog-offer', offerId),
        resolveRegistryTarget(request, token, 'quote', quoteId),
        resolveRegistryTarget(request, token, 'sales-order', orderId),
      ])
      expect(offer.href, 'offers canonically open their owning product').toBe(product.href)
      const renderSlots = [product, offer, quote, order].map((target) => ({
        slot: target.entityType === 'catalog-offer'
          ? 'offer'
          : target.entityType === 'sales-order'
            ? 'order'
            : target.entityType,
        entityType: target.entityType,
        entityId: target.entityId,
        label: target.label,
        href: target.href,
        values: target.values,
      }))
      const renderInput = {
        title: `TC-DOCUMENTS-016 generated ${stamp}`,
        templateUpdatedAt: template.updatedAt,
        locale: 'en-US',
        effectiveDate: '2026-07-11T12:00:00Z',
        slots: renderSlots,
      }
      const previewResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/templates/${template.id}/preview`,
        { token, data: renderInput },
      )
      const preview = await readJsonSafe<Preview>(previewResponse)
      expect(previewResponse.status()).toBe(200)
      expect(preview?.unresolvedTokens).toEqual([])
      for (const target of [product, offer, quote, order]) {
        expect(preview?.contentHtml).toContain(target.label)
      }
      expect(preview?.previewDigest).toMatch(/^sha256:[0-9a-f]{64}$/)

      const instantiateResponse = await apiRequest(request, 'POST', '/api/documents/instantiate', {
        token,
        data: {
          ...renderInput,
          templateId: template.id,
          folderId: null,
          previewDigest: preview?.previewDigest,
        },
      })
      const instantiated = await readJsonSafe<{ id?: string; links?: Array<{ entityType?: string }> }>(instantiateResponse)
      expect(instantiateResponse.status()).toBe(201)
      instantiatedDocumentId = expectId(instantiated?.id, 'instantiated document id')
      expect(instantiated?.links).toHaveLength(4)

      const contentResponse = await apiRequest(request, 'GET', `/api/documents/${instantiatedDocumentId}/content`, { token })
      const content = await readJsonSafe<{ contentHtml?: string; contentText?: string }>(contentResponse)
      expect(contentResponse.status()).toBe(200)
      expect(content?.contentHtml).toBe(preview?.contentHtml)
      for (const target of [product, offer, quote, order]) {
        expect(content?.contentText).toContain(target.label)
      }
      const persistedLinksResponse = await apiRequest(request, 'GET', `/api/documents/${instantiatedDocumentId}/links`, { token })
      const persistedLinks = await readJsonSafe<{ items?: Array<{ entityType?: string; entityId?: string; label?: string; href?: string }> }>(persistedLinksResponse)
      expect(persistedLinksResponse.status()).toBe(200)
      expect(persistedLinks?.items).toHaveLength(4)
      for (const target of [product, offer, quote, order]) {
        expect(persistedLinks?.items).toContainEqual(expect.objectContaining({
          entityType: target.entityType,
          entityId: target.entityId,
          label: target.label,
          href: target.href,
        }))
      }
      expect(persistedLinks?.items?.find((item) => item.entityType === 'catalog-offer')?.href).toBe(product.href)
    } finally {
      await deleteDocument(request, token, instantiatedDocumentId)
      await deleteTemplate(request, token, template)
      if (token && offerId) await apiRequest(request, 'DELETE', `/api/catalog/offers?id=${encodeURIComponent(offerId)}`, { token }).catch(() => undefined)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
      if (token && channelId) await apiRequest(request, 'DELETE', `/api/sales/channels?id=${encodeURIComponent(channelId)}`, { token }).catch(() => undefined)
    }
  })
})
