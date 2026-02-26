/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/translate/route'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockTranslateProposalContent = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/translationProvider', () => ({
  translateProposalContent: (...args: unknown[]) => mockTranslateProposalContent(...args),
}))

const authResult = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-1',
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authResult),
}))

const mockFlush = jest.fn()
const mockEm = { fork: jest.fn(), flush: mockFlush }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

function makeRequest(proposalId: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/inbox_ops/proposals/${proposalId}/translate`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/inbox_ops/proposals/[id]/translate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockFlush.mockResolvedValue(undefined)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('returns cached translation when available', async () => {
    const proposal = {
      id: 'proposal-1',
      summary: 'Order for widgets',
      workingLanguage: 'en',
      translations: {
        de: {
          summary: 'Bestellung für Widgets',
          actions: { 'a-1': 'Bestellung erstellen' },
          translatedAt: '2026-01-01T00:00:00Z',
        },
      },
      isActive: true,
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)

    const res = await POST(makeRequest('proposal-1', { targetLocale: 'de' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.cached).toBe(true)
    expect(json.translation.summary).toBe('Bestellung für Widgets')
    expect(mockTranslateProposalContent).not.toHaveBeenCalled()
  })

  it('calls LLM translation when no cache exists', async () => {
    const proposal = {
      id: 'proposal-1',
      summary: 'Order for widgets',
      workingLanguage: 'en',
      translations: null,
      isActive: true,
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)

    const actions = [
      { id: 'a-1', description: 'Create order', sortOrder: 0 },
      { id: 'a-2', description: 'Create contact', sortOrder: 1 },
    ]
    mockFindWithDecryption.mockResolvedValueOnce(actions)

    mockTranslateProposalContent.mockResolvedValueOnce({
      summary: 'Zamówienie na widgety',
      actions: { 'a-1': 'Utwórz zamówienie', 'a-2': 'Utwórz kontakt' },
    })

    const res = await POST(makeRequest('proposal-1', { targetLocale: 'pl' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.cached).toBe(false)
    expect(json.translation.summary).toBe('Zamówienie na widgety')
    expect(mockTranslateProposalContent).toHaveBeenCalledWith({
      summary: 'Order for widgets',
      actionDescriptions: { 'a-1': 'Create order', 'a-2': 'Create contact' },
      sourceLanguage: 'en',
      targetLocale: 'pl',
    })
    expect(mockFlush).toHaveBeenCalled()
  })

  it('returns 400 when target locale matches working language', async () => {
    const proposal = {
      id: 'proposal-1',
      summary: 'Order for widgets',
      workingLanguage: 'de',
      translations: null,
      isActive: true,
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)

    const res = await POST(makeRequest('proposal-1', { targetLocale: 'de' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('already in the requested language')
  })

  it('returns 404 when proposal not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const res = await POST(makeRequest('missing-id', { targetLocale: 'de' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid target locale', async () => {
    const proposal = {
      id: 'proposal-1',
      summary: 'Order',
      workingLanguage: 'en',
      translations: null,
      isActive: true,
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)

    const res = await POST(makeRequest('proposal-1', { targetLocale: 'fr' }))
    expect(res.status).toBe(400)
  })

  it('treats null workingLanguage as "en" for same-language check', async () => {
    const proposal = {
      id: 'proposal-1',
      summary: 'Order',
      workingLanguage: null,
      translations: null,
      isActive: true,
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)

    const res = await POST(makeRequest('proposal-1', { targetLocale: 'en' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('already in the requested language')
  })
})
