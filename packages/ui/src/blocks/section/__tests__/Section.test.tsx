import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { Section } from '../Section'
import { sectionFixtures } from '../fixtures'
import { sectionPropsSchema, type SectionProps } from '../../contracts/section'

const dict = {
  ui: {
    blocks: {
      section: {
        moreActions: 'More actions for {title}',
        count: '{count} items',
        loading: 'Loading {title}',
        error: 'Could not load this section',
        retry: 'Try again',
        empty: 'Nothing here yet',
        emptyDescription: 'Content will appear here once it is added.',
      },
    },
  },
}

const noop = () => undefined

function renderSection(props: SectionProps) {
  return renderWithProviders(<Section {...props} />, { dict })
}

function slot(name: string) {
  return document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null
}

function mockViewport(isWide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: isWide,
      media: query,
      addEventListener: noop,
      removeEventListener: noop,
    }),
  })
}

describe('Section', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  beforeEach(() => {
    mockViewport(true)
  })

  it('keeps every fixture valid against the contract', () => {
    for (const fixture of Object.values(sectionFixtures)) {
      expect(sectionPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('renders a region labelled by its heading', () => {
    renderSection({ title: 'Delivery addresses', children: <p>Body text</p> })
    const region = screen.getByRole('region', { name: 'Delivery addresses' })
    expect(region).toHaveAttribute('data-slot', 'section')
    expect(region.tagName).toBe('SECTION')
    expect(screen.getByRole('heading', { level: 2, name: 'Delivery addresses' })).toBeInTheDocument()
    expect(screen.getByText('Body text')).toBeInTheDocument()
  })

  it.each([2, 3, 4] as const)('renders the heading at level %s', (headingLevel) => {
    renderSection({ title: 'Contacts', headingLevel })
    expect(screen.getByRole('heading', { level: headingLevel, name: 'Contacts' })).toBeInTheDocument()
  })

  it('shows the description, the icon and the count', () => {
    renderSection({ title: 'Contacts', description: 'People at this company', icon: 'users', count: 4 })
    expect(slot('section-description')).toHaveTextContent('People at this company')
    expect(slot('section-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(slot('section-count')).toHaveTextContent('4 items')
    expect(slot('section-count')?.querySelector('[aria-hidden="true"]')).toHaveTextContent('4')
    expect(slot('section-title')).toHaveTextContent('Contacts')
    expect(slot('section-title')).not.toHaveTextContent('4')
  })

  it('shows a zero count', () => {
    renderSection({ title: 'Contacts', count: 0 })
    expect(slot('section-count')).toHaveTextContent('0')
  })

  it('draws the frame only in the card variant', () => {
    const { unmount } = renderSection({ title: 'Contacts', children: 'Body' })
    expect(slot('section')).toHaveClass('rounded-card', 'border', 'bg-card')
    expect(slot('section-body')).toHaveClass('px-4')
    unmount()
    renderSection({ title: 'Contacts', variant: 'plain', children: 'Body' })
    expect(slot('section')).not.toHaveClass('rounded-card')
    expect(slot('section')).not.toHaveClass('bg-card')
    expect(slot('section')).toHaveAttribute('data-variant', 'plain')
    expect(slot('section-body')).not.toHaveClass('px-4')
  })

  it('uses status tokens for the error tone', () => {
    renderSection({ title: 'Delete company', tone: 'error', icon: 'triangle-alert', children: 'Body' })
    expect(slot('section')).not.toHaveClass('border-status-error-border')
    expect(slot('section-header')).toHaveClass('bg-status-error-bg')
    expect(slot('section-title')).toHaveClass('text-foreground')
    expect(slot('section-icon')).toHaveClass('text-status-error-icon')
  })

  it('adds an alert icon to the error tone when no icon is given', () => {
    renderSection({ title: 'Delete company', tone: 'error', children: 'Body' })
    expect(slot('section-icon')).toHaveClass('text-status-error-icon')
  })

  it('marks a plain error section with an edge instead of a tinted strip', () => {
    renderSection({ title: 'Delete company', tone: 'error', variant: 'plain', children: 'Body' })
    expect(slot('section-main')).toHaveClass('border-l-2', 'border-status-error-icon')
    expect(slot('section-header')).not.toHaveClass('bg-status-error-bg')
  })

  it('draws the divider by default only for a flush body', () => {
    const { unmount } = renderSection({ title: 'Contacts', children: 'Body' })
    expect(slot('section-body')).not.toHaveClass('border-t')
    unmount()
    renderSection({ title: 'Contacts', divider: true, children: 'Body' })
    expect(slot('section-body')).toHaveClass('border-t', 'pt-4')
  })

  it('lets divider false remove the hairline of a flush body', () => {
    renderSection({ title: 'Team members', padding: 'none', divider: false, children: 'Table' })
    expect(slot('section-body')).not.toHaveClass('border-t')
  })

  it('switches to two columns by its own width in the split layout', () => {
    renderSection({ title: 'Order notifications', layout: 'split', children: 'Controls' })
    expect(slot('section')).toHaveAttribute('data-layout', 'split')
    expect(slot('section')).toHaveClass('@container/section')
    expect(slot('section-main')).toHaveClass('@2xl/section:grid', '@2xl/section:grid-cols-3')
    expect(slot('section-body')).toHaveClass('@2xl/section:col-span-2')
  })

  it('stays stacked by default', () => {
    renderSection({ title: 'Order notifications', children: 'Controls' })
    expect(slot('section')).toHaveAttribute('data-layout', 'stacked')
    expect(slot('section-main')).not.toHaveClass('@2xl/section:grid')
  })

  it('lets the body sit flush with padding none', () => {
    renderSection({ title: 'Team members', padding: 'none', children: 'Table' })
    expect(slot('section-body')).toHaveAttribute('data-padding', 'none')
    expect(slot('section-body')).not.toHaveClass('px-4')
    expect(slot('section-body')).toHaveClass('border-t')
  })

  it('renders the footer and header trailing slots', () => {
    renderSection({
      title: 'Notification rules',
      children: 'Body',
      footer: <span>Footer text</span>,
      headerTrailing: <button type="button">Enabled</button>,
    })
    expect(slot('section-footer')).toHaveTextContent('Footer text')
    expect(slot('section-footer')).toHaveClass('justify-end', 'border-t')
    expect(slot('section-footer-note')).toBeNull()
    expect(slot('section-header-trailing')).toContainElement(screen.getByRole('button', { name: 'Enabled' }))
  })

  it('renders the footer note at the left of the footer, also without footer content', () => {
    renderSection({ title: 'Notification rules', children: 'Body', footerNote: 'Applies to new orders.' })
    expect(slot('section-footer-note')).toHaveTextContent('Applies to new orders.')
    expect(slot('section-footer-note')).toHaveClass('mr-auto')
    expect(slot('section-footer-content')).toBeNull()
  })

  describe('actions', () => {
    it('shows three actions inline by default and the rest in the menu', async () => {
      const onAction = jest.fn()
      renderSection({ ...sectionFixtures.overflowingActions, onAction })
      expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'View history' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
      expect(onAction).toHaveBeenCalledWith('add')
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Contacts' }))
      expect(screen.getByText('Remove all')).toBeInTheDocument()
      fireEvent.click(screen.getByText('View history'))
      await waitFor(() => expect(onAction).toHaveBeenCalledWith('history'))
    })

    it('labels the first action and renders the others as named icon buttons', () => {
      renderSection(sectionFixtures.overflowingActions)
      const first = screen.getByRole('button', { name: 'Add contact' })
      expect(first).toHaveAttribute('data-appearance', 'label')
      expect(first).toHaveTextContent('Add contact')
      const second = screen.getByRole('button', { name: 'Import' })
      expect(second).toHaveAttribute('data-appearance', 'icon')
      expect(second).toHaveTextContent('')
    })

    it('keeps the label of a later action that has no icon', () => {
      renderSection({
        title: 'Contacts',
        actions: [
          { key: 'add', label: 'Add contact', icon: 'user-plus' },
          { key: 'merge', label: 'Merge duplicates' },
        ],
        onAction: noop,
      })
      const merge = screen.getByRole('button', { name: 'Merge duplicates' })
      expect(merge).toHaveAttribute('data-appearance', 'label')
      expect(merge).toHaveTextContent('Merge duplicates')
    })

    it('uses quiet buttons in the header', () => {
      renderSection(sectionFixtures.overflowingActions)
      for (const action of document.querySelectorAll('[data-slot="section-action"]')) {
        expect(action).not.toHaveClass('border')
        expect(action).not.toHaveClass('bg-primary')
      }
      expect(slot('section-more')).not.toHaveClass('border')
    })

    it('keeps a destructive action in the menu even when there is room', () => {
      renderSection({
        title: 'Contacts',
        actions: [{ key: 'remove-all', label: 'Remove all', tone: 'destructive' }],
        onAction: noop,
      })
      expect(screen.queryByRole('button', { name: 'Remove all' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'More actions for Contacts' })).toBeInTheDocument()
    })

    it('respects maxVisibleActions', () => {
      renderSection({ ...sectionFixtures.overflowingActions, maxVisibleActions: 1 })
      expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    })

    it('renders no menu when every action fits', () => {
      renderSection(sectionFixtures.default)
      expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
    })

    it('collapses every action into the menu on a phone viewport', () => {
      mockViewport(false)
      renderSection(sectionFixtures.default)
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Company details' }))
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Copy details')).toBeInTheDocument()
    })

    it('renders an action with href as a link and reports a plain click', () => {
      const onAction = jest.fn()
      renderSection({
        title: 'Contacts',
        actions: [{ key: 'open', label: 'Open list', href: '/contacts' }],
        onAction,
      })
      const link = screen.getByRole('link', { name: 'Open list' })
      expect(link).toHaveAttribute('href', '/contacts')
      fireEvent.click(link)
      expect(onAction).toHaveBeenCalledWith('open')
    })

    it('leaves a modified click on a link to the browser', () => {
      const onAction = jest.fn()
      renderSection({
        title: 'Contacts',
        actions: [{ key: 'open', label: 'Open list', href: '/contacts' }],
        onAction,
      })
      fireEvent.click(screen.getByRole('link', { name: 'Open list' }), { metaKey: true })
      expect(onAction).not.toHaveBeenCalled()
    })

    it('keeps a disabled action with a reason focusable and described', () => {
      const onAction = jest.fn()
      renderSection({
        title: 'Contacts',
        actions: [{ key: 'add', label: 'Add contact', disabled: true, disabledReason: 'The contact limit is reached' }],
        onAction,
      })
      const button = screen.getByRole('button', { name: 'Add contact' })
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      const reason = slot('section-action-reason') as HTMLElement
      expect(reason).toHaveTextContent('The contact limit is reached')
      expect(button).toHaveAttribute('aria-describedby', reason.id)
      fireEvent.click(button)
      expect(onAction).not.toHaveBeenCalled()
    })

    it('disables an action without a reason', () => {
      renderSection({ title: 'Contacts', actions: [{ key: 'add', label: 'Add contact', disabled: true }], onAction: noop })
      expect(screen.getByRole('button', { name: 'Add contact' })).toBeDisabled()
    })

    it('marks an action busy until its promise settles', async () => {
      let resolve: () => void = noop
      const onAction = jest.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done
          }),
      )
      renderSection({ title: 'Contacts', actions: [{ key: 'add', label: 'Add contact' }], onAction })
      const button = screen.getByRole('button', { name: 'Add contact' })
      fireEvent.click(button)
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(button).toBeDisabled()
      await act(async () => {
        resolve()
      })
      expect(button).not.toHaveAttribute('aria-busy')
      expect(button).not.toBeDisabled()
    })
  })

  describe('collapsible', () => {
    it('renders a real toggle button wired to the content', () => {
      renderSection({ title: 'Advanced settings', collapsible: true, children: <p>Body text</p> })
      const toggle = screen.getByRole('button', { name: 'Advanced settings' })
      const content = slot('section-body') as HTMLElement
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(toggle).toHaveAttribute('aria-controls', content.id)
      expect(content).not.toHaveAttribute('hidden')
      expect(toggle).toHaveClass('after:absolute', 'after:inset-0', 'focus-visible:shadow-focus')
      expect(slot('section-header')).toHaveClass('relative')
      expect(slot('section-chevron')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('heading', { level: 2, name: 'Advanced settings' })).toContainElement(toggle)
    })

    it('toggles uncontrolled and reports the change', () => {
      const onCollapsedChange = jest.fn()
      renderSection({
        title: 'Advanced settings',
        collapsible: true,
        defaultCollapsed: true,
        onCollapsedChange,
        children: <p>Body text</p>,
      })
      const toggle = screen.getByRole('button', { name: 'Advanced settings' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(slot('section-body')).toHaveAttribute('hidden')
      expect(slot('section')).toHaveAttribute('data-state', 'collapsed')
      fireEvent.click(toggle)
      expect(onCollapsedChange).toHaveBeenCalledWith(false)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(slot('section-body')).not.toHaveAttribute('hidden')
    })

    it('follows a controlled collapsed value', () => {
      const onCollapsedChange = jest.fn()
      renderSection({ title: 'Advanced settings', collapsible: true, collapsed: true, onCollapsedChange, children: 'Body' })
      const toggle = screen.getByRole('button', { name: 'Advanced settings' })
      fireEvent.click(toggle)
      expect(onCollapsedChange).toHaveBeenCalledWith(false)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('is a native button, so Enter and Space reach it through the keyboard', () => {
      renderSection({ title: 'Advanced settings', collapsible: true, children: 'Body' })
      const toggle = screen.getByRole('button', { name: 'Advanced settings' })
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle).toHaveAttribute('type', 'button')
      toggle.focus()
      expect(toggle).toHaveFocus()
    })

    it('shows the summary only while collapsed and hides the description and the footer', () => {
      renderSection({
        title: 'Advanced settings',
        description: 'Rarely changed options',
        collapsible: true,
        defaultCollapsed: true,
        summary: 'Rounding per line',
        footer: <span>Footer text</span>,
        children: <p>Body text</p>,
      })
      const summaries = document.querySelectorAll('[data-slot="section-summary"]')
      expect(summaries).toHaveLength(2)
      expect(summaries[0]).toHaveTextContent('Rounding per line')
      expect(summaries[0]).toHaveClass('@md/section:hidden')
      expect(summaries[1]).toHaveClass('hidden', '@md/section:flex')
      expect(slot('section-description')).toBeNull()
      expect(slot('section-footer')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
      expect(slot('section-summary')).toBeNull()
      expect(slot('section-description')).toHaveTextContent('Rarely changed options')
      expect(slot('section-footer')).toHaveTextContent('Footer text')
    })

    it('keeps header actions above the toggle area', () => {
      const onAction = jest.fn()
      const onCollapsedChange = jest.fn()
      renderSection({
        title: 'Shipping rules',
        collapsible: true,
        onCollapsedChange,
        actions: [{ key: 'add', label: 'Add rule', icon: 'plus-square' }],
        onAction,
        children: 'Body',
      })
      const action = screen.getByRole('button', { name: 'Add rule' })
      expect(action.closest('.relative')).not.toBe(slot('section-header'))
      fireEvent.click(action)
      expect(onAction).toHaveBeenCalledWith('add')
      expect(onCollapsedChange).not.toHaveBeenCalled()
    })

    it('ignores collapse props without collapsible', () => {
      renderSection({ title: 'Advanced settings', children: <p>Body text</p> })
      expect(screen.queryByRole('button', { name: 'Advanced settings' })).not.toBeInTheDocument()
      expect(slot('section')).not.toHaveAttribute('data-state')
    })
  })

  describe('states', () => {
    it('shows a skeleton and marks the region busy while loading', () => {
      renderSection({ title: 'Recent orders', status: 'loading', children: <p>Body text</p>, footer: 'Footer' })
      expect(slot('section')).toHaveAttribute('aria-busy', 'true')
      expect(slot('section-skeleton')).toHaveTextContent('Loading Recent orders')
      expect(slot('section-skeleton')).toHaveAttribute('data-shape', 'facts')
      expect(slot('section-skeleton')?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
      expect(screen.queryByText('Body text')).not.toBeInTheDocument()
      expect(slot('section-footer')).toBeNull()
      expect(screen.getByRole('heading', { name: 'Recent orders' })).toBeInTheDocument()
    })

    it('shows the error with a retry', () => {
      const onRetry = jest.fn()
      renderSection({ title: 'Recent orders', status: 'error', errorMessage: 'Could not load recent orders', onRetry })
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load recent orders')
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('falls back to a default error message and hides retry without onRetry', () => {
      renderSection({ title: 'Recent orders', status: 'error' })
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load this section')
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('shapes the skeleton like rows in a flush section', () => {
      renderSection({ title: 'Team members', status: 'loading', padding: 'none' })
      expect(slot('section-skeleton')).toHaveAttribute('data-shape', 'rows')
      expect(slot('section-body')).toHaveAttribute('data-padding', 'none')
    })

    it('keeps the error unframed inside the section', () => {
      renderSection({ title: 'Recent orders', status: 'error' })
      expect(screen.getByRole('alert')).toHaveClass('border-0', 'bg-transparent')
    })

    it('keeps the error padded in a flush section', () => {
      renderSection({ title: 'Recent orders', status: 'error', padding: 'none' })
      expect(slot('section-body')).toHaveClass('px-4')
    })

    it('shows the default empty state', () => {
      renderSection({ title: 'Recent orders', status: 'empty', children: <p>Body text</p> })
      expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
      expect(screen.getByText('Content will appear here once it is added.')).toBeInTheDocument()
      expect(screen.queryByText('Body text')).not.toBeInTheDocument()
    })

    it('shows a custom invitation and repeats the first header action', () => {
      const onAction = jest.fn()
      renderSection({
        title: 'Recent orders',
        status: 'empty',
        emptyTitle: 'No orders yet',
        emptyDescription: 'Orders will be listed here.',
        actions: [
          { key: 'remove-all', label: 'Remove all', tone: 'destructive' },
          { key: 'create', label: 'Create order', icon: 'plus-square' },
        ],
        onAction,
      })
      expect(screen.getByText('No orders yet')).toBeInTheDocument()
      expect(screen.getByText('Orders will be listed here.')).toBeInTheDocument()
      const repeated = slot('section-empty-action') as HTMLElement
      expect(repeated).toHaveTextContent('Create order')
      fireEvent.click(repeated)
      expect(onAction).toHaveBeenCalledWith('create')
    })

    it('shows no invitation button without actions', () => {
      renderSection({ title: 'Recent orders', status: 'empty' })
      expect(slot('section-empty-action')).toBeNull()
    })

    it('prefers the emptyState slot', () => {
      renderSection({ title: 'Recent orders', status: 'empty', emptyState: <p>No orders this month</p> })
      expect(screen.getByText('No orders this month')).toBeInTheDocument()
      expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument()
    })
  })
})
