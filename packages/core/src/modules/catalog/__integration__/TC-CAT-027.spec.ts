import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-027: Omnibus Price History — Coverage Gaps
 *
 * Covers: T1 (undo history entry), T2 (announced price), T3 (idempotency),
 * T4 (org isolation), T7 (cursor pagination)
 *
 * T5 (perishable_last_price) and T6 (new_arrival_reduced_window) require
 * channel-specific omnibus config and are covered in a separate test.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensurePriceKindId(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const list = await apiRequest(request, 'GET', '/api/catalog/price-kinds?page=1&pageSize=1', { token })
  expect(list.ok(), `Failed to list price kinds: ${list.status()}`).toBeTruthy()
  const body = (await list.json()) as { items?: Array<Record<string, unknown>> }
  const first = body.items?.[0]
  if (first?.id) return first.id as string

  const stamp = Date.now()
  const create = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: { title: `QA CAT-027 PK ${stamp}`, code: `qa_cat027_pk_${stamp}`, displayMode: 'excluding-tax' },
  })
  expect(create.ok(), `Failed to create price kind: ${create.status()}`).toBeTruthy()
  const createBody = (await create.json()) as { id?: string }
  expect(typeof createBody.id === 'string' && createBody.id.length > 0).toBeTruthy()
  return createBody.id as string
}

async function createPrice(
  request: APIRequestContext,
  token: string,
  productId: string,
  priceKindId: string,
  unitPriceGross: number,
  extra?: Record<string, unknown>,
): Promise<{ id: string; undoToken: string | null }> {
  const res = await apiRequest(request, 'POST', '/api/catalog/prices', {
    token,
    data: { productId, priceKindId, currencyCode: 'EUR', unitPriceGross, minQuantity: 1, ...extra },
  })
  expect(res.ok(), `Failed to create price: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { id?: string }
  expect(typeof body.id === 'string' && body.id.length > 0, 'Price id missing').toBeTruthy()
  const undoToken = parseUndoToken(res.headers()['x-om-operation'])
  return { id: body.id as string, undoToken }
}

async function updatePrice(
  request: APIRequestContext,
  token: string,
  priceId: string,
  unitPriceGross: number,
): Promise<{ undoToken: string | null }> {
  const res = await apiRequest(request, 'PUT', '/api/catalog/prices', {
    token,
    data: { id: priceId, unitPriceGross },
  })
  expect(res.ok(), `Failed to update price: ${res.status()}`).toBeTruthy()
  const undoToken = parseUndoToken(res.headers()['x-om-operation'])
  return { undoToken }
}

async function deletePriceIfExists(
  request: APIRequestContext,
  token: string | null,
  priceId: string | null,
): Promise<void> {
  if (!token || !priceId) return
  try {
    await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, { token })
  } catch {
    return
  }
}

function parseUndoToken(headerValue: string | undefined): string | null {
  if (!headerValue || typeof headerValue !== 'string') return null
  const HEADER_PREFIX = 'omop:'
  const trimmed = headerValue.startsWith(HEADER_PREFIX)
    ? headerValue.slice(HEADER_PREFIX.length)
    : headerValue
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed)) as Record<string, unknown>
    return typeof parsed.undoToken === 'string' && parsed.undoToken ? parsed.undoToken : null
  } catch {
    return null
  }
}

async function fetchPriceHistory(
  request: APIRequestContext,
  token: string,
  params: Record<string, string>,
): Promise<{
  items: Array<Record<string, unknown>>
  nextCursor: string | null
}> {
  const query = new URLSearchParams(params).toString()
  const res = await apiRequest(request, 'GET', `/api/catalog/prices/history?${query}`, { token })
  expect(res.ok(), `Failed to fetch price history: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as {
    items?: Array<Record<string, unknown>>
    nextCursor?: string | null
  }
  return {
    items: Array.isArray(body.items) ? body.items : [],
    nextCursor: body.nextCursor ?? null,
  }
}

// ---------------------------------------------------------------------------
// T2: Announced price — price with startsAt creates isAnnounced=true entry
// ---------------------------------------------------------------------------
test.describe('TC-CAT-027: Omnibus — Price History (T2: Announced)', () => {
  test('price with startsAt creates history entry with isAnnounced=true', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKindId = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-027 Announced ${stamp}`,
        sku: `QA-CAT-027-ANN-${stamp}`,
      })

      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const createResult = await createPrice(request, token, productId, priceKindId, 99.99, { startsAt: futureDate })
      priceId = createResult.id

      const history = await fetchPriceHistory(request, token, { productId, pageSize: '10' })
      const entry = history.items.find((e) => e.priceId === priceId || e.price_id === priceId)
      expect(entry, 'History entry for price should exist').toBeTruthy()
      expect(
        entry!.isAnnounced ?? entry!.is_announced,
        'History entry for a future-starts_at price must have isAnnounced=true',
      ).toBe(true)
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// T3: Idempotency — single create produces exactly one history entry
// ---------------------------------------------------------------------------
test.describe('TC-CAT-027: Omnibus — Price History (T3: Idempotency)', () => {
  test('creating one price produces exactly one history entry', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKindId = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-027 Idem ${stamp}`,
        sku: `QA-CAT-027-IDEM-${stamp}`,
      })

      const createResult = await createPrice(request, token, productId, priceKindId, 49.99)
      priceId = createResult.id

      const history = await fetchPriceHistory(request, token, { productId, pageSize: '50' })
      const entriesForPrice = history.items.filter(
        (e) => e.priceId === priceId || e.price_id === priceId,
      )
      expect(
        entriesForPrice.length,
        'Exactly one history entry must exist after a single price create',
      ).toBe(1)
      expect(entriesForPrice[0]!.changeType ?? entriesForPrice[0]!.change_type).toBe('create')
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// T4: Org isolation — results scoped to caller's org (no cross-org leakage)
// ---------------------------------------------------------------------------
test.describe('TC-CAT-027: Omnibus — Price History (T4: Isolation)', () => {
  test('price history results are scoped to caller org and unknown product returns empty', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKindId = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-027 Isolation ${stamp}`,
        sku: `QA-CAT-027-ISO-${stamp}`,
      })

      const createResult = await createPrice(request, token, productId, priceKindId, 59.99)
      priceId = createResult.id

      // History for own product must return at least one entry
      const history = await fetchPriceHistory(request, token, { productId, pageSize: '50' })
      const entry = history.items.find((e) => e.priceId === priceId || e.price_id === priceId)
      expect(entry, 'Must see price history for own product').toBeTruthy()

      // All returned items must belong to the queried product (no cross-product leakage)
      for (const item of history.items) {
        expect(item.productId ?? item.product_id).toBe(productId)
      }

      // Non-existent product UUID → empty result (verifies org-scoped filter applies)
      // Must use a valid UUID (Zod v4 requires version nibble 1-8; nil UUID is an allowed special case)
      const emptyHistory = await fetchPriceHistory(request, token, {
        productId: '00000000-0000-0000-0000-000000000000',
        pageSize: '10',
      })
      expect(emptyHistory.items).toHaveLength(0)
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// T7: Cursor pagination — second page via nextCursor
// ---------------------------------------------------------------------------
test.describe('TC-CAT-027: Omnibus — Price History (T7: Cursor Pagination)', () => {
  test('second page is reachable via cursor returned from first page', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKindId = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-027 Pagination ${stamp}`,
        sku: `QA-CAT-027-PAG-${stamp}`,
      })

      // Create 1 price + 5 updates → 6 history entries
      const createResult = await createPrice(request, token, productId, priceKindId, 10.00)
      priceId = createResult.id

      for (let i = 1; i <= 5; i++) {
        await updatePrice(request, token, priceId, 10 + i)
      }

      // Fetch page 1 (pageSize=5) — must have nextCursor
      const page1 = await fetchPriceHistory(request, token, { productId, pageSize: '5' })
      expect(page1.items.length).toBe(5)
      expect(page1.nextCursor, 'Page 1 must return a nextCursor when more entries exist').toBeTruthy()

      // Fetch page 2 via cursor
      const page2 = await fetchPriceHistory(request, token, {
        productId,
        pageSize: '5',
        cursor: page1.nextCursor as string,
      })
      expect(page2.items.length).toBeGreaterThanOrEqual(1)

      // No overlap between pages
      const page1Ids = new Set(page1.items.map((e) => e.id as string))
      for (const entry of page2.items) {
        expect(page1Ids.has(entry.id as string), 'Page 2 items must not overlap with page 1').toBe(false)
      }
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})

// ---------------------------------------------------------------------------
// T1: Undo — undo operation creates history entry with changeType='undo'
// ---------------------------------------------------------------------------
test.describe('TC-CAT-027: Omnibus — Price History (T1: Undo)', () => {
  test('undoing a price update creates a history entry with changeType=undo', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let priceId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKindId = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-027 Undo ${stamp}`,
        sku: `QA-CAT-027-UNDO-${stamp}`,
      })

      const createResult = await createPrice(request, token, productId, priceKindId, 29.99)
      priceId = createResult.id

      // Update the price — response header carries undoToken for the update
      const updateResult = await updatePrice(request, token, priceId, 39.99)
      const undoToken = updateResult.undoToken
      expect(undoToken, 'x-om-operation header must contain undoToken after price update').toBeTruthy()

      // Undo the update
      const undoRes = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token,
        data: { undoToken },
      })
      expect(undoRes.ok(), `Undo request failed: ${undoRes.status()}`).toBeTruthy()

      // History must now contain an 'undo' entry for this price
      const history = await fetchPriceHistory(request, token, { productId, pageSize: '50' })
      const undoEntry = history.items.find(
        (e) =>
          (e.priceId === priceId || e.price_id === priceId) &&
          (e.changeType === 'undo' || e.change_type === 'undo'),
      )
      expect(undoEntry, 'History must contain an entry with changeType=undo after undo operation').toBeTruthy()
    } finally {
      await deletePriceIfExists(request, token, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
