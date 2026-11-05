/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CategorySelect } from '../CategorySelect'

const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

const sampleNodes = [
  { id: 'cat-1', name: 'Electronics', isActive: true },
  { id: 'cat-2', name: 'Books', isActive: true },
  { id: 'cat-3', name: 'Archived', isActive: false },
]

describe('CategorySelect', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('renders provided nodes as options', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Electronics')).toBeInTheDocument()
    expect(screen.getByText('Books')).toBeInTheDocument()
  })

  it('renders empty option by default with custom label', () => {
    render(
      <CategorySelect
        nodes={sampleNodes}
        fetchOnMount={false}
        emptyOptionLabel="-- Pick a category --"
      />,
    )
    expect(screen.getByText('-- Pick a category --')).toBeInTheDocument()
  })

  it('omits the empty option when includeEmptyOption is false', () => {
    render(
      <CategorySelect
        nodes={sampleNodes}
        fetchOnMount={false}
        includeEmptyOption={false}
      />,
    )
    expect(screen.queryByText('Root level')).not.toBeInTheDocument()
  })

  it('fires onChange with selected value', () => {
    const handleChange = jest.fn()
    render(
      <CategorySelect nodes={sampleNodes} fetchOnMount={false} onChange={handleChange} />,
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'cat-2' } })
    expect(handleChange).toHaveBeenCalledWith('cat-2')
  })

  it('fires onChange with null when empty option is selected', () => {
    const handleChange = jest.fn()
    render(
      <CategorySelect
        nodes={sampleNodes}
        fetchOnMount={false}
        onChange={handleChange}
        value="cat-1"
      />,
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '' } })
    expect(handleChange).toHaveBeenCalledWith(null)
  })

  it('fetches categories on mount when fetchOnMount is true', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: sampleNodes })
    render(<CategorySelect fetchOnMount={true} />)
    await waitFor(() => {
      expect(screen.getByText('Electronics')).toBeInTheDocument()
    })
    expect(mockReadApiResultOrThrow).toHaveBeenCalled()
  })

  it('shows loading state during fetch', () => {
    mockReadApiResultOrThrow.mockReturnValue(new Promise(() => {}))
    render(<CategorySelect fetchOnMount={true} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeDisabled()
  })

  it('shows error state on failed fetch', async () => {
    mockReadApiResultOrThrow.mockRejectedValue(new Error('Network error'))
    render(<CategorySelect fetchOnMount={true} />)
    await waitFor(() => {
      const select = screen.getByRole('combobox')
      expect(select).toBeDisabled()
    })
  })

  it('disables the select when disabled prop is true', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} disabled={true} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeDisabled()
  })

  it('reflects the pre-selected value', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} value="cat-2" />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('cat-2')
  })

  it('sets required attribute when required prop is true', () => {
    render(<CategorySelect nodes={sampleNodes} fetchOnMount={false} required={true} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeRequired()
  })
})
