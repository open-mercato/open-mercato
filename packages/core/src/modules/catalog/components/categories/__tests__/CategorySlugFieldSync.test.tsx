/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { CategorySlugFieldSync } from '../CategorySlugFieldSync'

jest.mock('@open-mercato/shared/lib/slugify', () => ({
  slugify: (input: string) =>
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
}))

describe('CategorySlugFieldSync', () => {
  let setValue: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    setValue = jest.fn()
  })

  it('auto-syncs slug when name changes', async () => {
    const { rerender } = render(
      <CategorySlugFieldSync values={{ name: '', slug: '' }} errors={{}} setValue={setValue} />,
    )
    rerender(
      <CategorySlugFieldSync values={{ name: 'Summer Hat', slug: '' }} errors={{}} setValue={setValue} />,
    )
    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('slug', 'summer-hat')
    })
  })

  it('stops auto-sync when slug is manually edited', async () => {
    const { rerender } = render(
      <CategorySlugFieldSync values={{ name: 'Hat', slug: 'hat' }} errors={{}} setValue={setValue} />,
    )
    // simulate manual slug edit
    rerender(
      <CategorySlugFieldSync values={{ name: 'Hat', slug: 'custom-slug' }} errors={{}} setValue={setValue} />,
    )
    // now change name — slug should NOT auto-sync
    rerender(
      <CategorySlugFieldSync values={{ name: 'New Hat', slug: 'custom-slug' }} errors={{}} setValue={setValue} />,
    )
    // setValue should not have been called with a new slug
    await waitFor(() => {
      const slugCalls = setValue.mock.calls.filter(
        ([field]: [string]) => field === 'slug',
      )
      const hasAutoSlug = slugCalls.some(
        ([, value]: [string, string]) => value === 'new-hat',
      )
      expect(hasAutoSlug).toBe(false)
    })
  })

  it('re-enables auto-sync when slug is cleared', async () => {
    const { rerender } = render(
      <CategorySlugFieldSync values={{ name: 'Hat', slug: 'custom-slug' }} errors={{}} setValue={setValue} />,
    )
    // clear slug
    rerender(
      <CategorySlugFieldSync values={{ name: 'Hat', slug: '' }} errors={{}} setValue={setValue} />,
    )
    // change name — should auto-sync again
    rerender(
      <CategorySlugFieldSync values={{ name: 'Winter Boots', slug: '' }} errors={{}} setValue={setValue} />,
    )
    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('slug', 'winter-boots')
    })
  })

  it('clears slug when name is emptied while in auto mode', async () => {
    const { rerender } = render(
      <CategorySlugFieldSync values={{ name: '', slug: '' }} errors={{}} setValue={setValue} />,
    )
    rerender(
      <CategorySlugFieldSync values={{ name: 'Hat', slug: '' }} errors={{}} setValue={setValue} />,
    )
    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('slug', 'hat')
    })
    rerender(
      <CategorySlugFieldSync values={{ name: 'Hat', slug: 'hat' }} errors={{}} setValue={setValue} />,
    )
    rerender(
      <CategorySlugFieldSync values={{ name: '', slug: 'hat' }} errors={{}} setValue={setValue} />,
    )
    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('slug', '')
    })
  })

  it('renders nothing (returns null)', () => {
    const { container } = render(
      <CategorySlugFieldSync values={{ name: 'Test', slug: '' }} errors={{}} setValue={setValue} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('handles multiple rapid name changes', async () => {
    const { rerender } = render(
      <CategorySlugFieldSync values={{ name: '', slug: '' }} errors={{}} setValue={setValue} />,
    )
    rerender(
      <CategorySlugFieldSync values={{ name: 'A', slug: '' }} errors={{}} setValue={setValue} />,
    )
    rerender(
      <CategorySlugFieldSync values={{ name: 'Ab', slug: '' }} errors={{}} setValue={setValue} />,
    )
    rerender(
      <CategorySlugFieldSync values={{ name: 'Abc', slug: '' }} errors={{}} setValue={setValue} />,
    )
    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('slug', 'abc')
    })
  })
})
