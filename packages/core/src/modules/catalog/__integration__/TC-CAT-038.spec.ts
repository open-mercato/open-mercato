import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-CAT-038: Omnibus price history — `GET /api/catalog/prices/history`.
 * Source: .ai/specs/2026-06-30-omnibus-price-tracking.md ("Integration tests (shipped)").
 *
 * The append-only price-history log is the evidence base for the Omnibus reference price, so
 * this spec covers the properties a compliance log must hold end-to-end:
 *   - an announced price change is recorded with `isAnnounced=true`;
 *   - a price write records exactly ONE entry (idempotency key holds under retry);
 *   - entries never cross an organization boundary;
 *   - the keyset cursor walks the whole log without overlap or gaps;
 *   - an undo is itself recorded, with `changeType='undo'`.
 *
 * Self-contained: every test creates its own price kind, product and prices and removes them in
 * `finally`. The isolation test additionally provisions a second organization plus a confined
 * user, and tears both down. No seeded catalog data is assumed.
 *
 * ENVIRONMENT: the isolation test mixes API fixtures with a DB-level organization fixture (raw
 * `pg` against `DATABASE_URL`, because the directory create command denies non-super-admin
 * actors), so it MUST run under the standard `yarn test:integration` /
 * `yarn test:integration:ephemeral` harness where the app and the fixtures share one database.
 */

type HistoryItem = Record<string, unknown>

type HistoryPage = {
  status: number
  items: HistoryItem[]
  nextCursor: string | null
  total?: number
}

async function createPriceKind(
  request: APIRequestContext,
  token: string,
  slug: string,
): Promise<{ id: string; currencyCode: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const response = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      title: `QA TC-CAT-038 ${slug} ${stamp}`,
      code: `qa_cat038_${slug}_${stamp}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
    },
  })
  expect(response.ok(), `Failed to create price kind: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string; result?: { id?: string } }>(response)
  const id = body?.id ?? body?.result?.id
  expect(typeof id === 'string' && id.length > 0, 'Price kind id missing').toBeTruthy()
  return { id: id as string, currencyCode: 'USD' }
}

async function createPrice(
  request: APIRequestContext,
  token: string,
  input: {
    productId: string
    priceKindId: string
    currencyCode: string
    unitPriceGross: number
    minQuantity?: number
    startsAt?: string
  },
): Promise<{ id: string; response: APIResponse }> {
  const data: Record<string, unknown> = {
    productId: input.productId,
    priceKindId: input.priceKindId,
    currencyCode: input.currencyCode,
    minQuantity: input.minQuantity ?? 1,
    unitPriceNet: input.unitPriceGross,
    unitPriceGross: input.unitPriceGross,
  }
  if (input.startsAt) data.startsAt = input.startsAt
  const response = await apiRequest(request, 'POST', '/api/catalog/prices', { token, data })
  expect(response.ok(), `Failed to create price: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string' && body.id.length > 0, 'Price id missing').toBeTruthy()
  return { id: body?.id as string, response }
}

async function fetchHistory(
  request: APIRequestContext,
  token: string,
  params: Record<string, string>,
): Promise<HistoryPage> {
  const query = new URLSearchParams(params).toString()
  const response = await apiRequest(request, 'GET', `/api/catalog/prices/history?${query}`, { token })
  const body = await readJsonSafe<{ items?: HistoryItem[]; nextCursor?: string | null; total?: number }>(
    response,
  )
  return {
    status: response.status(),
    items: Array.isArray(body?.items) ? (body?.items as HistoryItem[]) : [],
    nextCursor: body?.nextCursor ?? null,
    total: body?.total,
  }
}

function entriesForPrice(page: HistoryPage, priceId: string): HistoryItem[] {
  return page.items.filter((entry) => entry.priceId === priceId)
}

async function deletePriceIfExists(
  request: APIRequestContext,
  token: string | null,
  priceId: string | null,
): Promise<void> {
  if (!token || !priceId) return
  await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, {
    token,
  }).catch(() => undefined)
}

async function deletePriceKindIfExists(
  request: APIRequestContext,
  token: string | null,
  priceKindId: string | null,
): Promise<void> {
  if (!token || !priceKindId) return
  await apiRequest(request, 'DELETE', `/api/catalog/price-kinds?id=${encodeURIComponent(priceKindId)}`, {
    token,
  }).catch(() => undefined)
}

test.describe('TC-CAT-038: Omnibus price history', () => {
  test('an announced price change is recorded with isAnnounced=true', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const priceKind = await createPriceKind(request, token, 'ann')
      priceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-038 Announced ${Date.now()}`,
        sku: `QA-CAT-038-ANN-${Date.now()}`,
      })

      // A future `startsAt` is a scheduled — i.e. announced — price change.
      const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const created = await createPrice(request, token, {
        productId,
        priceKindId: priceKind.id,
        currencyCode: priceKind.currencyCode,
        unitPriceGross: 99.99,
        startsAt,
      })
      priceId = created.id

      const page = await fetchHistory(request, token, { productId, pageSize: '50' })
      expect(page.status, 'price history GET should be 200').toBe(200)
      const entries = entriesForPrice(page, priceId)
      expect(entries.length, 'the announced price write must be recorded').toBeGreaterThan(0)

      const entry = entries[0] as HistoryItem
      expect(entry.isAnnounced, 'a scheduled (startsAt) price change must be recorded as announced').toBe(
        true,
      )
      expect(entry.changeType, 'the first entry for a new price must be a create').toBe('create')
      expect(entry.startsAt, 'the announced entry must carry the scheduled startsAt').toBeTruthy()
      const unitPriceGross = entry.unitPriceGross
      expect(
        typeof unitPriceGross === 'string' && /^\d+\.\d{4}$/.test(unitPriceGross),
        `money must be serialized as a 4-decimal string, got ${JSON.stringify(unitPriceGross)}`,
      ).toBe(true)
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deletePriceKindIfExists(request, token, priceKindId)
    }
  })

  test('a repeated read of a single price write returns exactly one entry (idempotency)', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const priceKind = await createPriceKind(request, token, 'idem')
      priceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-038 Idempotency ${Date.now()}`,
        sku: `QA-CAT-038-IDEM-${Date.now()}`,
      })

      const created = await createPrice(request, token, {
        productId,
        priceKindId: priceKind.id,
        currencyCode: priceKind.currencyCode,
        unitPriceGross: 49.99,
      })
      priceId = created.id

      // The recorder is best-effort and runs on a forked EM after the price flush; the partial
      // unique idempotency index is what keeps a retried write from double-recording. Observed at
      // the API boundary that means: one write, exactly one entry — stable across repeated reads.
      const firstRead = await fetchHistory(request, token, { productId, pageSize: '50' })
      expect(entriesForPrice(firstRead, priceId).length, 'one create must record exactly one entry').toBe(1)

      const secondRead = await fetchHistory(request, token, {
        productId,
        pageSize: '50',
        includeTotal: 'true',
      })
      const secondEntries = entriesForPrice(secondRead, priceId)
      expect(secondEntries.length, 'a repeated read must not surface a duplicate entry').toBe(1)
      expect(secondEntries[0]!.id, 'the recorded entry id must be stable across reads').toBe(
        entriesForPrice(firstRead, priceId)[0]!.id,
      )
      expect(secondEntries[0]!.changeType, 'the single entry must be the create').toBe('create')
      expect(secondRead.total, 'includeTotal must report the scoped entry count').toBe(
        secondRead.items.length,
      )
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deletePriceKindIfExists(request, token, priceKindId)
    }
  })

  test('price history never crosses an organization boundary', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const password = 'Secret123!'
    const orgBUserEmail = `tc-cat-038-orgb-${stamp}@example.com`

    let adminToken: string | null = null
    let orgBToken: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let orgBUserId: string | null = null
    let productId: string | null = null
    let priceId: string | null = null
    let priceKindId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenScope(adminToken)
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

      // Org B is a fresh, unseeded organization in the same tenant: a cross-tenant read would be
      // rejected before the organization guard runs, which would not prove anything about org scope.
      orgBId = await createOrganizationInDb({ name: `TC-CAT-038 Org B ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, adminToken, { name: `TC-CAT-038 Org B ${stamp}` })
      orgBUserId = await createUserFixture(request, adminToken, {
        email: orgBUserEmail,
        password,
        organizationId: orgBId,
        roles: [roleId],
      })
      await setUserAclVisibility(request, adminToken, {
        userId: orgBUserId,
        features: ['catalog.products.view', 'catalog.price_history.view'],
        organizations: [orgBId],
      })
      orgBToken = await getAuthToken(request, orgBUserEmail, password)
      expect(getTokenScope(orgBToken).organizationId, 'org B user token should be scoped to org B').toBe(
        orgBId,
      )

      const priceKind = await createPriceKind(request, adminToken, 'iso')
      priceKindId = priceKind.id
      productId = await createProductFixture(request, adminToken, {
        title: `QA TC-CAT-038 Isolation ${stamp}`,
        sku: `QA-CAT-038-ISO-${stamp}`,
      })
      const created = await createPrice(request, adminToken, {
        productId,
        priceKindId: priceKind.id,
        currencyCode: priceKind.currencyCode,
        unitPriceGross: 59.99,
      })
      priceId = created.id

      // Org A sees its own entry, and every returned row belongs to the queried product.
      const orgAPage = await fetchHistory(request, adminToken, { productId, pageSize: '50' })
      expect(orgAPage.status, 'org A price history GET should be 200').toBe(200)
      expect(entriesForPrice(orgAPage, priceId).length, 'org A must see its own history entry').toBe(1)
      for (const entry of orgAPage.items) {
        expect(entry.productId, 'a scoped query must not leak other products').toBe(productId)
      }

      // Org B is authorized for the route but must see nothing of org A's log.
      const orgBScoped = await fetchHistory(request, orgBToken, { productId, pageSize: '50' })
      expect(orgBScoped.status, 'org B price history GET should be 200, not an error').toBe(200)
      expect(orgBScoped.items, "org B must not see org A's price history for that product").toHaveLength(0)

      const orgBUnscoped = await fetchHistory(request, orgBToken, { pageSize: '100' })
      expect(orgBUnscoped.status, 'org B unfiltered price history GET should be 200').toBe(200)
      expect(
        orgBUnscoped.items.every((entry) => entry.productId !== productId),
        "an unfiltered org B read must not contain org A's entries",
      ).toBe(true)
    } finally {
      await deletePriceIfExists(request, adminToken, priceId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deletePriceKindIfExists(request, adminToken, priceKindId)
      await deleteUserIfExists(request, adminToken, orgBUserId)
      await deleteUserAclInDb(orgBUserId ?? '').catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })

  test('the keyset cursor walks the whole log without overlap', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const tierCount = 6
    const pageSize = 3

    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null
    const priceIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      const priceKind = await createPriceKind(request, token, 'pag')
      priceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-038 Pagination ${stamp}`,
        sku: `QA-CAT-038-PAG-${stamp}`,
      })

      // Six tier prices on one product ⇒ six `create` entries in the scoped log.
      for (let tier = 1; tier <= tierCount; tier += 1) {
        const created = await createPrice(request, token, {
          productId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          unitPriceGross: 10 + tier,
          minQuantity: tier,
        })
        priceIds.push(created.id)
      }

      const seenIds = new Set<string>()
      let cursor: string | null = null
      let pages = 0

      do {
        const params: Record<string, string> = { productId, pageSize: String(pageSize) }
        if (cursor) params.cursor = cursor
        const page: HistoryPage = await fetchHistory(request, token, params)
        expect(page.status, 'paged price history GET should be 200').toBe(200)
        expect(page.items.length, 'a page must never exceed the requested pageSize').toBeLessThanOrEqual(
          pageSize,
        )
        for (const entry of page.items) {
          const entryId = entry.id as string
          expect(seenIds.has(entryId), 'cursor pages must not overlap').toBe(false)
          seenIds.add(entryId)
        }
        cursor = page.nextCursor
        pages += 1
        expect(pages, 'cursor pagination must terminate').toBeLessThanOrEqual(tierCount + 2)
      } while (cursor)

      expect(pages, 'six entries at pageSize=3 must span more than one page').toBeGreaterThan(1)
      expect(seenIds.size, 'the cursor walk must return every recorded entry exactly once').toBe(
        tierCount,
      )
    } finally {
      for (const priceId of priceIds) {
        await deletePriceIfExists(request, token, priceId)
      }
      await deleteCatalogProductIfExists(request, token, productId)
      await deletePriceKindIfExists(request, token, priceKindId)
    }
  })

  test('undoing a price write records an entry with changeType=undo', async ({ request }) => {
    test.slow()
    skipIfUndoTestsDisabled()

    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null
    let priceKindId: string | null = null
    let priceStillExists = true

    try {
      token = await getAuthToken(request, 'admin')
      const priceKind = await createPriceKind(request, token, 'undo')
      priceKindId = priceKind.id

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-038 Undo ${stamp}`,
        sku: `QA-CAT-038-UNDO-${stamp}`,
      })

      const created = await createPrice(request, token, {
        productId,
        priceKindId: priceKind.id,
        currencyCode: priceKind.currencyCode,
        unitPriceGross: 29.99,
      })
      priceId = created.id

      const operation = expectOperation(created.response, 'catalog price create')
      await undoOk(request, token, operation.undoToken, 'catalog price create')
      priceStillExists = false

      // An undo reverses the price but never rewrites the log: it appends its own entry.
      const page = await fetchHistory(request, token, { productId, pageSize: '50' })
      expect(page.status, 'price history GET should be 200').toBe(200)
      const entries = entriesForPrice(page, priceId)
      const changeTypes = entries.map((entry) => entry.changeType)
      expect(changeTypes, 'the original create entry must survive the undo').toContain('create')
      expect(changeTypes, 'the undo itself must be recorded').toContain('undo')
    } finally {
      if (priceStillExists) await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deletePriceKindIfExists(request, token, priceKindId)
    }
  })
})
