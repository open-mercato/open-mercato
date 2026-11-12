/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { GalleryShell } from '../components/GalleryShell'
import type { GalleryEntry } from '../types'

const mockSearchParams = new URLSearchParams('family=buttons&entry=button')
const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/backend/design-system',
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ onClick, onNavigate, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate?: (event: { preventDefault: () => void }) => void }) => (
    <a {...props} onClick={event => {
      onClick?.(event)
      if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) onNavigate?.({ preventDefault: () => event.preventDefault() })
      event.preventDefault()
    }} />
  ),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({ items: [], isLoading: false }),
}))

jest.mock('../registry', () => ({
  GALLERY_BASE_PATH: '/backend/design-system',
  galleryFamilies: [{
    id: 'buttons',
    labelKey: 'design_system.families.buttons',
    load: async (): Promise<{ entries: GalleryEntry[] }> => ({ entries: [{
      id: 'button',
      title: 'Button',
      importPath: '@open-mercato/ui/primitives/button',
      variants: [{ id: 'default', title: 'Default', render: () => <button>Live specimen</button>, code: '<Button />' }],
    }] }),
  }, {
    id: 'foundations',
    labelKey: 'design_system.families.foundations',
    load: async (): Promise<{ entries: GalleryEntry[] }> => ({ entries: [{
      id: 'color-roles',
      title: 'Color roles',
      importPath: 'tokens.css',
      variants: [{ id: 'default', title: 'Default', render: () => <p>Color specimen</p>, code: '' }],
    }] }),
  }, {
    id: 'inputs',
    labelKey: 'design_system.families.inputs',
    load: async (): Promise<{ entries: GalleryEntry[] }> => ({ entries: [{
      id: 'input',
      title: 'Input',
      importPath: '@open-mercato/ui/primitives/input',
      variants: [{ id: 'default', title: 'Default', render: () => <input aria-label="Input specimen" />, code: '<Input />' }],
    }] }),
  }],
}))

function mountGallery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  return render(<I18nProvider locale="en" dict={{
    'design_system.styleAgents.title': 'Style agents',
    'design_system.portal.nav.components': 'Components',
    'design_system.portal.browse': 'Browse components',
    'design_system.gallery.backToNamedFamily': 'Back to {family}',
  }}><GalleryShell /></I18nProvider>, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = jest.fn()
})

describe('native gallery search navigation', () => {
  it('opens style agents as one sidebar destination without component search or duplicate studio on home', async () => {
    mockSearchParams.delete('family')
    mockSearchParams.delete('entry')
    mockSearchParams.set('view', 'style-agents')
    try {
      mountGallery()
      expect(screen.getByRole('heading', { name: 'Style agents', level: 1 })).toBeVisible()
      expect(screen.getByRole('link', { name: 'Style agents' })).toHaveAttribute('href', '/backend/design-system?view=style-agents')
      expect(screen.getAllByRole('navigation')).toHaveLength(1)
      expect(screen.queryByRole('searchbox', { name: 'Search components…' })).toBeNull()
      expect(document.querySelectorAll('[data-example="color-playground"]')).toHaveLength(1)
    } finally {
      mockSearchParams.delete('view')
      mockSearchParams.set('family', 'buttons')
      mockSearchParams.set('entry', 'button')
    }
  })

  it('opens the complete component index from the home browse action', async () => {
    mockSearchParams.delete('family')
    mockSearchParams.delete('entry')
    try {
      const view = mountGallery()
      expect(screen.getByRole('link', { name: 'Browse components' })).toHaveAttribute('href', '/backend/design-system?view=components')
      mockSearchParams.set('view', 'components')
      view.rerender(<I18nProvider locale="en" dict={{ 'design_system.portal.nav.components': 'Components' }}><GalleryShell /></I18nProvider>)
      expect(screen.getByRole('heading', { name: 'Components', level: 1 })).toBeVisible()
      expect(await screen.findByText('Live specimen')).toBeVisible()
      expect(await screen.findByLabelText('Input specimen')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'buttons' })).toBeVisible()
      expect(screen.getByRole('region', { name: 'inputs' })).toBeVisible()
      expect((HTMLElement.prototype.scrollIntoView as jest.Mock).mock.contexts.at(-1)).toBe(document.getElementById('gallery-page-heading'))
    } finally {
      mockSearchParams.delete('view')
      mockSearchParams.set('family', 'buttons')
      mockSearchParams.set('entry', 'button')
    }
  })

  it('keeps foundations navigation focused and preserves section deep links', async () => {
    mockSearchParams.set('family', 'foundations')
    mockSearchParams.set('entry', 'color-roles')
    try {
      mountGallery()
      expect(await screen.findByText('Color specimen')).toBeVisible()
      expect(screen.getAllByRole('navigation')).toHaveLength(1)
      expect(screen.getByRole('link', { name: 'Color roles' })).toHaveAttribute('href', '/backend/design-system?family=foundations&entry=color-roles')
      expect(screen.getByRole('link', { name: 'All components' })).toHaveAttribute('href', '/backend/design-system?view=components')
      expect(screen.getByRole('link', { name: 'Buttons' })).toHaveAttribute('href', '/backend/design-system?family=buttons')
      expect((HTMLElement.prototype.scrollIntoView as jest.Mock).mock.contexts.at(-1)).toBe(document.getElementById('gallery-entry-color-roles'))
    } finally {
      mockSearchParams.set('family', 'buttons')
      mockSearchParams.set('entry', 'button')
    }
  })

  it('names the component and provides a visible return to its family', async () => {
    mountGallery()
    expect(await screen.findByRole('heading', { name: 'Button', level: 1 })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to Buttons' })).toHaveAttribute('href', '/backend/design-system?family=buttons')
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('keeps detail focused on one title and its own controls', async () => {
    mountGallery()
    await screen.findByRole('button', { name: 'Live specimen' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getAllByRole('heading', { name: 'Button', exact: true })).toHaveLength(1)
    expect(screen.queryByRole('combobox', { name: 'Preview width' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Button', exact: true })).toHaveAttribute('href', '/backend/design-system?family=buttons&entry=button')
  })

  it('exits search when the active family link is selected again', async () => {
    mockSearchParams.delete('entry')
    try {
      mountGallery()
      await screen.findByRole('button', { name: 'Live specimen' })
      const search = screen.getByRole('searchbox', { name: 'Search components…' })
      fireEvent.change(search, { target: { value: 'missing component' } })
      expect(await screen.findByText('No components match your search')).toBeVisible()
      fireEvent.click(screen.getByRole('link', { name: 'Buttons' }))
      expect(search).toHaveValue('')
      expect(await screen.findByRole('button', { name: 'Live specimen' })).toBeVisible()
    } finally {
      mockSearchParams.set('entry', 'button')
    }
  })

  it('exits search and closes the mobile navigation when the current family is selected', async () => {
    mockSearchParams.delete('entry')
    mountGallery()
    await screen.findByRole('button', { name: 'Live specimen' })
    const search = screen.getByRole('searchbox', { name: 'Search components…' })
    fireEvent.change(search, { target: { value: 'missing component' } })
    const toggle = screen.getByRole('button', { name: 'design_system.gallery.navigation.browse' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('link', { name: 'Buttons' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(search).toHaveValue('')
    expect(await screen.findByRole('button', { name: 'Live specimen' })).toBeVisible()
    mockSearchParams.set('entry', 'button')
  })
})
