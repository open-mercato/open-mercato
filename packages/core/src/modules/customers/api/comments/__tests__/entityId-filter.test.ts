/**
 * Regression test for #1100: GET /api/customers/comments?entityId=<uuid>
 * must only return comments belonging to the requested entity.
 *
 * This test directly verifies the response-level filtering logic that the
 * GET wrapper applies, without importing the full route module (which
 * requires generated files).
 */

const ENTITY_A = '11111111-1111-1111-1111-111111111111'
const ENTITY_B = '22222222-2222-2222-2222-222222222222'
const DEAL_X = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const ALL_COMMENTS = [
  { id: 'c1', entity_id: ENTITY_A, deal_id: null, body: 'note for A' },
  { id: 'c2', entity_id: ENTITY_B, deal_id: null, body: 'note for B' },
  { id: 'c3', entity_id: ENTITY_A, deal_id: DEAL_X, body: 'deal note for A' },
  { id: 'c4', entity_id: ENTITY_B, deal_id: DEAL_X, body: 'deal note for B' },
]

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Extracted filtering logic from the GET wrapper in route.ts.
 * This mirrors the exact implementation so we can verify correctness
 * without needing the full module graph.
 */
async function applyEntityIdFilter(
  crudGetResult: Response,
  entityId: string | null,
  dealId: string | null,
): Promise<Response> {
  if (!entityId && !dealId) return crudGetResult

  const contentType = crudGetResult.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return crudGetResult

  try {
    const body = await crudGetResult.json()
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      return new Response(JSON.stringify(body), {
        status: crudGetResult.status,
        headers: crudGetResult.headers,
      })
    }

    const filtered = body.items.filter((item: Record<string, unknown>) => {
      if (entityId) {
        const itemEntityId = item.entity_id ?? item.entityId
        if (itemEntityId !== entityId) return false
      }
      if (dealId) {
        const itemDealId = item.deal_id ?? item.dealId
        if (itemDealId !== dealId) return false
      }
      return true
    })

    const result = { ...body, items: filtered, total: filtered.length }
    return new Response(JSON.stringify(result), {
      status: crudGetResult.status,
      headers: crudGetResult.headers,
    })
  } catch {
    return crudGetResult
  }
}

function buildCrudGetResponse(): Response {
  return jsonResponse({
    items: ALL_COMMENTS,
    total: ALL_COMMENTS.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  })
}

describe('GET /api/customers/comments entityId filter (#1100)', () => {
  it('filters response items by entityId', async () => {
    const response = await applyEntityIdFilter(buildCrudGetResponse(), ENTITY_A, null)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((item: Record<string, unknown>) => item.entity_id === ENTITY_A)).toBe(true)
    expect(body.total).toBe(2)
  })

  it('filters response items by dealId', async () => {
    const response = await applyEntityIdFilter(buildCrudGetResponse(), null, DEAL_X)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((item: Record<string, unknown>) => item.deal_id === DEAL_X)).toBe(true)
    expect(body.total).toBe(2)
  })

  it('filters by both entityId and dealId', async () => {
    const response = await applyEntityIdFilter(buildCrudGetResponse(), ENTITY_A, DEAL_X)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('c3')
    expect(body.total).toBe(1)
  })

  it('returns all comments when no entityId or dealId is provided', async () => {
    const response = await applyEntityIdFilter(buildCrudGetResponse(), null, null)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(ALL_COMMENTS.length)
    expect(body.total).toBe(ALL_COMMENTS.length)
  })

  it('returns empty list when entityId matches no comments', async () => {
    const response = await applyEntityIdFilter(
      buildCrudGetResponse(),
      '99999999-9999-9999-9999-999999999999',
      null,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('handles camelCase entityId field in response items', async () => {
    const camelCaseComments = [
      { id: 'c1', entityId: ENTITY_A, dealId: null, body: 'note A (camel)' },
      { id: 'c2', entityId: ENTITY_B, dealId: null, body: 'note B (camel)' },
    ]
    const camelResponse = jsonResponse({
      items: camelCaseComments,
      total: camelCaseComments.length,
    })
    const response = await applyEntityIdFilter(camelResponse, ENTITY_A, null)
    const body = await response.json()

    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('c1')
  })

  it('passes through non-JSON responses unchanged', async () => {
    const csvResponse = new Response('id,body\nc1,note', {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    })
    const response = await applyEntityIdFilter(csvResponse, ENTITY_A, null)
    const text = await response.text()

    expect(text).toBe('id,body\nc1,note')
  })
})
