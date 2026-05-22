/**
 * @jest-environment jsdom
 *
 * Step 5.15 — Catalog merchandising injection widget unit tests.
 *
 * Covers:
 *  - Trigger renders via the shared `MerchandisingAssistantSheet`.
 *  - `computeCatalogMerchandisingPageContext` builds the spec §10.1
 *    `MerchandisingPageContext` from the DataTable's `injectionContext`
 *    payload (filters + total-matching count).
 *  - Missing / malformed inputs degrade to safe defaults.
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import MerchandisingAssistantTriggerWidget, {
  computeCatalogMerchandisingPageContext,
} from '../widget.client'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('../../../../components/CatalogStatsCard', () => ({}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!fallback) return _key
    if (!vars) return fallback
    return fallback.replace(/\{(\w+)\}/g, (_m, name) =>
      name in vars ? String((vars as Record<string, unknown>)[name]) : `{${name}}`,
    )
  },
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

describe('catalog MerchandisingAssistantTriggerWidget', () => {
  beforeEach(() => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        agents: [{ id: 'catalog.merchandising_assistant' }],
      },
    })
  })

  afterEach(() => {
    mockApiCall.mockReset()
  })

  it('renders the merchandising trigger via the shared sheet component', async () => {
    render(
      <MerchandisingAssistantTriggerWidget
        context={{ totalMatching: 7, filters: {} }}
      />,
    )
    const trigger = await screen.findByRole('button', { name: /open ai merchandising assistant/i })
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('data-ai-merchandising-trigger')).toBe('')
  })

  it('hides the trigger when the merchandising agent is disabled by overrides', async () => {
    mockApiCall.mockResolvedValueOnce({
      ok: true,
      result: {
        agents: [{ id: 'customers.account_assistant' }],
      },
    })

    render(
      <MerchandisingAssistantTriggerWidget
        context={{ totalMatching: 7, filters: {} }}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /open ai merchandising assistant/i })).toBeNull()
  })
})

describe('catalog computeCatalogMerchandisingPageContext (Step 5.15)', () => {
  it('produces the spec §10.1 shape with an empty selection', () => {
    const ctx = computeCatalogMerchandisingPageContext({
      filters: {
        categoryIds: ['cat-a'],
        tagIds: ['tag-1', 'tag-2'],
        status: 'active',
      },
      totalMatching: 42,
    })
    expect(ctx.view).toBe('catalog.products.list')
    expect(ctx.recordType).toBeNull()
    expect(ctx.recordId).toBe('')
    expect(ctx.extra.totalMatching).toBe(42)
    expect(ctx.extra.selectedCount).toBe(0)
    expect(ctx.extra.filter).toEqual({
      categoryId: 'cat-a',
      priceRange: null,
      tags: ['tag-1', 'tag-2'],
      status: 'active',
    })
  })

  it('degrades gracefully when the DataTable has not supplied a total', () => {
    const ctx = computeCatalogMerchandisingPageContext({ filters: {} })
    expect(ctx.extra.totalMatching).toBe(0)
    expect(ctx.extra.filter).toEqual({
      categoryId: null,
      priceRange: null,
      tags: [],
      status: null,
    })
  })

  it('coerces string totalMatching and picks the first valid category id', () => {
    const ctx = computeCatalogMerchandisingPageContext({
      filters: {
        categoryIds: ['', 'cat-b', 'cat-c'],
        tagIds: [null, 'tag-4'] as unknown as string[],
      },
      total: '12',
    } as unknown as Parameters<typeof computeCatalogMerchandisingPageContext>[0])
    expect(ctx.extra.totalMatching).toBe(12)
    expect(ctx.extra.filter.categoryId).toBe('cat-b')
    expect(ctx.extra.filter.tags).toEqual(['tag-4'])
  })
})
