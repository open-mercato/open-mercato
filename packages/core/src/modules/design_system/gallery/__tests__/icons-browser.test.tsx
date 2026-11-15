/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { IconsBrowser } from '../components/IconsBrowser'
import { loadSourceArtwork } from '@open-mercato/ui/assets/source-artwork'

jest.mock('@open-mercato/ui/assets/source-icons', () => ({
  sourceIconNames: ['accessibility', ...Array.from({ length: 50 }, (_, index) => `sample-${index}`), 'zoom-in'],
  SourceIcon: ({ name }: { name: string }) => <svg data-icon={name} />,
}))
jest.mock('@open-mercato/ui/assets/source-artwork', () => ({ loadSourceArtwork: jest.fn() }))

const dict = {
  'design_system.gallery.assets.collection': 'Collection',
  'design_system.gallery.assets.icons': 'Icons',
  'design_system.gallery.assets.flags': 'Flags',
  'design_system.gallery.assets.brands': 'Logos',
  'design_system.gallery.iconSearchPlaceholder': 'Filter icons',
  'design_system.gallery.sourceArtwork.search': 'Search artwork',
  'design_system.gallery.sourceIcons.copy': 'Copy JSX',
  'design_system.gallery.sourceIcons.copied': 'Copied',
  'design_system.gallery.noResults': 'No results',
}
function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale="en" dict={dict}>{children}</I18nProvider>
}

beforeEach(() => {
  jest.mocked(loadSourceArtwork).mockImplementation(async group => [{
    id: 'asset-1', name: group === 'country-flags' ? 'Poland' : 'Open Mercato', category: 'Original',
    src: '/test.svg', width: 32, height: 32,
  }])
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue(undefined) } })
})

it('opens the complete icon collection with one search and no permanent detail panel', async () => {
  render(<IconsBrowser onNavigate={jest.fn()} />, { wrapper })
  expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent('Icons')
  expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Copy JSX' })).toBeNull()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter icons' }), { target: { value: 'zoom-in' } })
  fireEvent.click(screen.getByRole('button', { name: 'zoom-in' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy JSX' }))
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('name="zoom-in"')))
  expect(screen.queryByRole('button', { name: 'accessibility' })).toBeNull()
})

it('preserves artwork variant deep links and resets the search when the collection changes', async () => {
  const { rerender } = render(<IconsBrowser entryId="source-artwork" variantId="flags" onNavigate={jest.fn()} />, { wrapper })
  expect(await screen.findByRole('button', { name: 'Poland' })).toBeVisible()
  expect(loadSourceArtwork).toHaveBeenCalledWith('country-flags')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search artwork' }), { target: { value: 'missing' } })
  expect(screen.getByText('No results')).toBeVisible()
  rerender(<IconsBrowser entryId="source-artwork" variantId="brands" onNavigate={jest.fn()} />)
  expect(await screen.findByRole('button', { name: 'Open Mercato' })).toBeVisible()
  expect(screen.getByRole('searchbox', { name: 'Search artwork' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent('Logos')
})

it('keeps the collection selector available when an artwork collection cannot load', async () => {
  jest.mocked(loadSourceArtwork).mockRejectedValueOnce(new Error('Asset unavailable'))
  render(<IconsBrowser entryId="source-artwork" variantId="flags" onNavigate={jest.fn()} />, { wrapper })
  await screen.findByRole('button', { name: 'design_system.gallery.retry' })
  expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent('Flags')
})

it('opens original thumbnail illustrations and searches their translated names', async () => {
  jest.mocked(loadSourceArtwork).mockResolvedValueOnce([
    { id: '193452:25880', name: 'Color Palette', group: 'thumbnails', category: 'Components', width: 270, height: 220, src: '/test.svg' },
    { id: '193695:50822', name: 'Blog', group: 'thumbnails', category: 'Landing sections', width: 270, height: 220, src: '/test.svg' },
  ])
  render(<I18nProvider locale="pl" dict={{
    ...dict,
    'design_system.gallery.assets.thumbnails': 'Ilustracje / Miniatury',
    'design_system.gallery.thumbnailNames.Color Palette': 'Paleta kolorów',
  }}><IconsBrowser entryId="source-artwork" variantId="thumbnails" onNavigate={jest.fn()} /></I18nProvider>)
  expect(await screen.findByRole('button', { name: 'Paleta kolorów' })).toBeVisible()
  expect(loadSourceArtwork).toHaveBeenCalledWith('thumbnails')
  expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent('Ilustracje / Miniatury')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search artwork' }), { target: { value: 'kolorów' } })
  expect(screen.queryByRole('button', { name: 'Blog' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Paleta kolorów' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy JSX' }))
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("loadSourceArtwork('thumbnails')")))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("item.id === '193452:25880'"))
})
