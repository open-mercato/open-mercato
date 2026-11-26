import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EntityHeader } from '../EntityHeader'
import { entityHeaderFixtures } from '../fixtures'
import { entityHeaderPropsSchema, type EntityHeaderProps } from '../../contracts/entity-header'

const dict = {
  ui: {
    blocks: {
      entityHeader: {
        moreActions: 'More actions',
        loading: 'Loading',
        error: 'Something went wrong',
        retry: 'Try again',
      },
    },
  },
}

function renderHeader(props: EntityHeaderProps) {
  return renderWithProviders(<EntityHeader {...props} />, { dict })
}

function deferred() {
  let resolve: () => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('EntityHeader', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('renders the title as h1 with subtitle and status badge', () => {
    renderHeader(entityHeaderFixtures.default)
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Corporation' })).toBeInTheDocument()
    expect(screen.getByText('Customer since March 2021')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders meta labels and values without separators', () => {
    renderHeader(entityHeaderFixtures.default)
    const meta = document.querySelector('[data-slot="entity-header-meta"]') as HTMLElement
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('Jan Kowalski')).toBeInTheDocument()
    expect(meta.textContent).not.toMatch(/[:·•|\/]/)
  })

  it('renders the avatar initials', () => {
    renderHeader(entityHeaderFixtures.default)
    expect(screen.getByRole('img', { name: 'AC' })).toBeInTheDocument()
  })

  it('shows a primary default button, at most two other buttons, and a menu with the rest', () => {
    renderHeader({
      ...entityHeaderFixtures.default,
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'share', label: 'Share' },
        { key: 'duplicate', label: 'Duplicate' },
        { key: 'export', label: 'Export' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
    })
    const visible = ['Edit', 'Share', 'Duplicate'].map((name) => screen.getByRole('button', { name }))
    expect(visible).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('data-action-emphasis', 'primary')
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('data-action-emphasis', 'secondary')
    expect(screen.getByRole('button', { name: 'Duplicate' })).toHaveAttribute('data-action-emphasis', 'secondary')
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Export')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls onAction with the key for visible and overflow actions', () => {
    const onAction = jest.fn()
    renderHeader({ ...entityHeaderFixtures.default, onAction })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onAction).toHaveBeenCalledWith('edit')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Delete'))
    expect(onAction).toHaveBeenCalledWith('delete')
  })

  it('disables a button while a promise is pending and re-enables after resolve', async () => {
    const pending = deferred()
    renderHeader({ ...entityHeaderFixtures.default, onAction: () => pending.promise })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled())
  })

  it('re-enables a button after the promise rejects', async () => {
    const pending = deferred()
    renderHeader({ ...entityHeaderFixtures.default, onAction: () => pending.promise })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled()
    await act(async () => {
      pending.reject(new Error('failed'))
      await pending.promise.catch(() => undefined)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled())
  })

  it('keeps a disabled-with-reason button focusable, aria-disabled and inert, with the reason announced', () => {
    const onAction = jest.fn()
    renderHeader({ ...entityHeaderFixtures.disabledAction, onAction })
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onAction).not.toHaveBeenCalled()
    const reasonId = button.getAttribute('aria-describedby') as string
    expect(document.getElementById(reasonId)?.textContent).toBe('Another user is editing this record')
    expect(document.querySelector('span[tabindex]')).toBeNull()
  })

  it('renders overflow items with icon and disabled reason description', () => {
    renderHeader({
      title: 'Acme',
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'a', label: 'A', tone: 'destructive' },
        { key: 'archive', label: 'Archive', icon: 'star', disabled: true, disabledReason: 'Archiving is locked' },
      ],
      primaryActionKey: 'edit',
      onAction: () => undefined,
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const item = screen.getByText('Archive').closest('[role="option"], [role="menuitem"], [data-slot]') as HTMLElement
    expect(screen.getByText('Archiving is locked')).toBeInTheDocument()
    expect(item.querySelector('svg')).not.toBeNull()
  })

  it('disables the overflow trigger and shows a spinner while an overflow action is pending', async () => {
    const pending = deferred()
    renderHeader({
      title: 'Acme',
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
      primaryActionKey: 'edit',
      onAction: (key) => (key === 'delete' ? pending.promise : undefined),
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Delete'))
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toBeEnabled())
  })

  it('renders the header normally for status empty', () => {
    renderHeader({ ...entityHeaderFixtures.default, status: 'empty' })
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Corporation' })).toBeInTheDocument()
  })

  it('renders no actions for the read-only scenario', () => {
    renderHeader(entityHeaderFixtures.readOnly)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the minimal scenario with only a title', () => {
    renderHeader(entityHeaderFixtures.minimal)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders leading, trailing and below slots', () => {
    renderHeader(entityHeaderFixtures.withSlots)
    expect(document.querySelector('[data-slot="entity-header-leading"]')).not.toBeNull()
    expect(screen.getByText('Synced')).toBeInTheDocument()
    expect(screen.getByText('Last contact two days ago')).toBeInTheDocument()
  })

  it('renders the loading state', () => {
    renderHeader(entityHeaderFixtures.loading)
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders a skeleton shaped like the header while loading', () => {
    renderHeader(entityHeaderFixtures.loading)
    const root = document.querySelector('[data-slot="entity-header"]') as HTMLElement
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(root.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(6)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the error state with the error message', () => {
    renderHeader(entityHeaderFixtures.error)
    expect(screen.getByRole('alert')).toHaveTextContent('The record could not be loaded')
  })

  it('keeps the title and avatar in the error state and offers retry', () => {
    const onRetry = jest.fn()
    renderHeader({ ...entityHeaderFixtures.error, avatar: { initials: 'AC' }, onRetry })
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Corporation' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'AC' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders no retry button in the error state without onRetry', () => {
    renderHeader({ title: 'Acme Corporation', status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the disabled reason as visible helper text outside the tooltip', () => {
    renderHeader(entityHeaderFixtures.disabledAction)
    const reason = document.querySelector('[data-slot="entity-header-action-reason"]') as HTMLElement
    expect(reason).toHaveTextContent('Another user is editing this record')
    expect(reason.className).toContain('md:sr-only')
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-describedby', reason.id)
  })

  it('keeps the trailing slot apart from the action buttons', () => {
    renderHeader(entityHeaderFixtures.withSlots)
    const trailing = document.querySelector('[data-slot="entity-header-trailing"]') as HTMLElement
    const buttons = document.querySelector('[data-slot="entity-header-buttons"]') as HTMLElement
    expect(trailing).toHaveTextContent('Synced')
    expect(buttons).not.toHaveTextContent('Synced')
    expect(document.querySelector('[data-slot="entity-header-actions"]')).toContainElement(trailing)
  })

  it('gives the overflow trigger the same height classes as the action buttons', () => {
    renderHeader(entityHeaderFixtures.default)
    const edit = screen.getByRole('button', { name: 'Edit' })
    const more = screen.getByRole('button', { name: 'More actions' })
    expect(edit.className).toContain('h-10')
    expect(edit.className).toContain('sm:h-8')
    expect(more.className).toContain('size-10')
    expect(more.className).toContain('sm:size-8')
  })

  it('renders avatar initials without heavy weight', () => {
    renderHeader(entityHeaderFixtures.default)
    const avatar = screen.getByRole('img', { name: 'AC' })
    expect(avatar.className).toContain('font-normal')
    expect(avatar.className).not.toContain('font-semibold')
  })

  it('renders an icon for an action with a resolvable icon name', () => {
    renderHeader({
      title: 'Acme',
      actions: [{ key: 'edit', label: 'Edit', icon: 'star' }],
      primaryActionKey: 'edit',
      onAction: () => undefined,
    })
    expect(screen.getByRole('button', { name: 'Edit' }).querySelector('svg')).not.toBeNull()
  })

  it('renders no icon when the icon name does not resolve', () => {
    renderHeader({
      title: 'Acme',
      actions: [{ key: 'edit', label: 'Edit', icon: 'not-a-real-icon' }],
      primaryActionKey: 'edit',
      onAction: () => undefined,
    })
    expect(screen.getByRole('button', { name: 'Edit' }).querySelector('svg')).toBeNull()
  })

  it('parses every fixture against the contract schema', () => {
    for (const [name, fixture] of Object.entries(entityHeaderFixtures)) {
      expect({ name, ok: entityHeaderPropsSchema.safeParse(fixture).success }).toEqual({ name, ok: true })
    }
  })
})
