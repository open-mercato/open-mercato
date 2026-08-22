/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

const mockTranslateWithFallback = jest.fn((_: unknown, key: string, fallback: string) => fallback)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  translateWithFallback: (...args: unknown[]) => (mockTranslateWithFallback as unknown as (...a: unknown[]) => string)(...args),
}))

const mockScopeVersion = jest.fn(() => 1)
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion(),
}))

const mockDictionaryData: { entries: Array<{ value: string; label: string; color: string | null }> } | null = {
  entries: [],
}
const mockUseCustomerDictionary = jest.fn(() => ({ data: mockDictionaryData }))
jest.mock('../../../../../../components/detail/hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: (...args: unknown[]) => mockUseCustomerDictionary(...args),
}))

import { StatusFilterPopover } from '../StatusFilterPopover'

function setDictionaryEntries(entries: Array<{ value: string; label: string; color: string | null }>) {
  if (mockDictionaryData) {
    mockDictionaryData.entries = entries
  }
  mockUseCustomerDictionary.mockReturnValue({ data: { entries, map: {}, fullEntries: [] } } as unknown as ReturnType<typeof mockUseCustomerDictionary>)
}

describe('StatusFilterPopover', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTranslateWithFallback.mockImplementation((_: unknown, __: string, fallback: string) => fallback)
    setDictionaryEntries([])
  })

  it('renders dictionary entries as pills with dictionary label and dot', async () => {
    setDictionaryEntries([
      { value: 'open', label: 'Open', color: '#2563eb' },
      { value: 'win', label: 'Win', color: '#22c55e' },
      { value: 'loose', label: 'Loose', color: '#ef4444' },
    ])

    render(<StatusFilterPopover values={[]} onApply={jest.fn()} />)

    // Open the popover
    fireEvent.click(screen.getByRole('button', { name: /Status/ }))

    expect(await screen.findByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Win')).toBeInTheDocument()
    expect(screen.getByText('Loose')).toBeInTheDocument()
  })

  it('falls back to hard-coded pills when dictionary is empty', async () => {
    setDictionaryEntries([])

    render(<StatusFilterPopover values={[]} onApply={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Status/ }))

    expect(await screen.findByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()
    expect(screen.getByText('Lost')).toBeInTheDocument()
  })

  it('marks Won as selected when values contains alias won', async () => {
    setDictionaryEntries([
      { value: 'open', label: 'Open', color: '#2563eb' },
      { value: 'win', label: 'Win', color: '#22c55e' },
      { value: 'loose', label: 'Loose', color: '#ef4444' },
    ])

    render(<StatusFilterPopover values={['won']} onApply={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Status/ }))

    const winButton = await screen.findByRole('button', { name: 'Win' })
    expect(winButton).toHaveAttribute('aria-pressed', 'true')
    // Chip value should show canonical label
    expect(screen.getByRole('button', { name: /Status/ })).toHaveTextContent('Win')
  })

  it('emits canonical value on apply after toggling', async () => {
    setDictionaryEntries([
      { value: 'open', label: 'Open', color: '#2563eb' },
      { value: 'win', label: 'Win', color: '#22c55e' },
    ])

    const onApply = jest.fn()
    render(<StatusFilterPopover values={[]} onApply={onApply} />)

    fireEvent.click(screen.getByRole('button', { name: /Status/ }))

    const winButton = await screen.findByRole('button', { name: 'Win' })
    fireEvent.click(winButton)

    const applyButton = screen.getByRole('button', { name: /Apply/ })
    fireEvent.click(applyButton)

    expect(onApply).toHaveBeenCalledWith(['win'])
  })

  it('de-duplicates win/won dictionary entries into single pill', async () => {
    setDictionaryEntries([
      { value: 'win', label: 'Win', color: '#22c55e' },
      { value: 'won', label: 'Won', color: '#22c55e' },
      { value: 'open', label: 'Open', color: '#2563eb' },
    ])

    render(<StatusFilterPopover values={[]} onApply={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Status/ }))

    const winButtons = await screen.findAllByRole('button', { name: /Win|Won/ })
    // Should be single pill for canonical win, not two
    expect(winButtons).toHaveLength(1)
  })
})
