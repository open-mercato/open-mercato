/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderHook, waitFor } from '@testing-library/react'

const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

import {
  collectMissingTaxRateIds,
  mergeTaxRateSummaries,
  normalizeTaxRateSummary,
  useEnsureSelectedTaxRates,
} from '../taxRateOptions'
import type { TaxRateSummary } from '../productForm'

const rate = (id: string, name = id): TaxRateSummary => ({
  id,
  name,
  code: null,
  rate: 23,
  isDefault: false,
})

describe('normalizeTaxRateSummary', () => {
  it('maps snake_case and camelCase API items into the summary shape', () => {
    expect(
      normalizeTaxRateSummary(
        { id: 'tax-1', name: 'VAT', code: 'vat', rate: 23, is_default: true },
        'Untitled',
      ),
    ).toEqual({ id: 'tax-1', name: 'VAT', code: 'vat', rate: 23, isDefault: true })
  })

  it('falls back to the unnamed label and null code/rate', () => {
    expect(normalizeTaxRateSummary({ id: 'tax-2', rate: 'nope' }, 'Untitled')).toEqual({
      id: 'tax-2',
      name: 'Untitled',
      code: null,
      rate: null,
      isDefault: false,
    })
  })

  it('returns null for items without an id', () => {
    expect(normalizeTaxRateSummary({ name: 'no id' }, 'Untitled')).toBeNull()
    expect(normalizeTaxRateSummary(null, 'Untitled')).toBeNull()
  })
})

describe('collectMissingTaxRateIds', () => {
  it('returns selected ids not present in the loaded list', () => {
    const loaded = [rate('a'), rate('b')]
    expect(collectMissingTaxRateIds(loaded, ['a', 'c', null, undefined, 'd', 'd'])).toEqual([
      'c',
      'd',
    ])
  })

  it('returns an empty array when every selection is present', () => {
    expect(collectMissingTaxRateIds([rate('a')], ['a', null])).toEqual([])
  })
})

describe('mergeTaxRateSummaries', () => {
  it('appends new entries and de-duplicates by id', () => {
    const merged = mergeTaxRateSummaries([rate('a')], [rate('a', 'changed'), rate('b')])
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b'])
    // existing entry is preserved (not overwritten by the incoming duplicate)
    expect(merged[0].name).toBe('a')
  })

  it('returns the existing list unchanged when there is nothing to merge', () => {
    const existing = [rate('a')]
    expect(mergeTaxRateSummaries(existing, [])).toBe(existing)
  })
})

describe('useEnsureSelectedTaxRates', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('fetches selected ids missing from the capped list and merges them', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({
      items: [{ id: 'omitted', name: 'Omitted VAT', code: 'om', rate: 8, is_default: false }],
    })
    const merged: TaxRateSummary[][] = []
    const taxRates = [rate('loaded')]
    const setTaxRates = ((updater: (prev: TaxRateSummary[]) => TaxRateSummary[]) => {
      const next = updater(taxRates)
      merged.push(next)
    }) as React.Dispatch<React.SetStateAction<TaxRateSummary[]>>

    renderHook(() =>
      useEnsureSelectedTaxRates({
        taxRates,
        setTaxRates,
        selectedIds: ['loaded', 'omitted'],
        unnamedLabel: 'Untitled',
        errorMessage: 'failed',
      }),
    )

    await waitFor(() => expect(merged.length).toBeGreaterThan(0))
    const url = mockReadApiResultOrThrow.mock.calls[0][0] as string
    expect(url).toContain('/api/sales/tax-rates?ids=omitted')
    expect(merged[0].map((entry) => entry.id)).toEqual(['loaded', 'omitted'])
  })

  it('does not fetch when every selection is already present', async () => {
    renderHook(() =>
      useEnsureSelectedTaxRates({
        taxRates: [rate('loaded')],
        setTaxRates: jest.fn(),
        selectedIds: ['loaded', null],
        unnamedLabel: 'Untitled',
        errorMessage: 'failed',
      }),
    )
    await Promise.resolve()
    expect(mockReadApiResultOrThrow).not.toHaveBeenCalled()
  })
})
