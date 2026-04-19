/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  LinkEntityDialog,
  type LinkEntityAdapter,
  type LinkEntityOption,
} from '../LinkEntityDialog'

function buildAdapter(
  overrides: Partial<LinkEntityAdapter> = {},
  options: LinkEntityOption[] = [
    { id: 'a', label: 'Acme Corp', subtitle: 'acme.com' },
    { id: 'b', label: 'Globex', subtitle: 'globex.com' },
    { id: 'c', label: 'Initech', subtitle: null },
  ],
): LinkEntityAdapter {
  return {
    kind: 'company',
    dialogTitle: 'Link company',
    dialogSubtitle: 'Link an existing company to this record',
    sectionLabel: 'MATCHING COMPANIES',
    searchPlaceholder: 'Search…',
    searchEmptyHint: 'No results.',
    selectedEmptyHint: 'None selected.',
    confirmButtonLabel: 'Link company',
    searchPage: jest.fn(async () => ({ items: options, totalPages: 1, total: options.length })),
    fetchByIds: jest.fn(async (ids: string[]) =>
      ids.map((id) => options.find((option) => option.id === id) ?? { id, label: id }),
    ),
    ...overrides,
  }
}

function getSearchResultRow(label: string): HTMLElement {
  const row = screen
    .getAllByText(label)
    .map((element) => element.closest('[role="button"]'))
    .find((button): button is HTMLElement => button instanceof HTMLElement && button.getAttribute('aria-pressed') !== null)
  if (!row) {
    throw new Error(`Unable to find search result row for ${label}`)
  }
  return row
}

describe('LinkEntityDialog', () => {
  it('renders dialog title and subtitle', async () => {
    const adapter = buildAdapter()
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={() => undefined}
        adapter={adapter}
        initialSelectedIds={[]}
        onConfirm={async () => undefined}
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Link company' })).toBeInTheDocument(),
    )
    expect(
      screen.getByText('Link an existing company to this record'),
    ).toBeInTheDocument()
  })

  it('toggles selection when a row is clicked and reports diff on save', async () => {
    const adapter = buildAdapter()
    const onConfirm = jest.fn(async () => undefined)
    const onOpenChange = jest.fn()
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={onOpenChange}
        adapter={adapter}
        initialSelectedIds={['a']}
        onConfirm={onConfirm}
      />,
    )

    await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(getSearchResultRow('Acme Corp'))
    })
    await act(async () => {
      fireEvent.click(getSearchResultRow('Globex'))
    })

    const saveButton = screen.getAllByRole('button', { name: /Link company/ }).find((b) => b.textContent?.includes('Link company'))!
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const call = onConfirm.mock.calls[0][0] as Parameters<typeof onConfirm>[0]
    expect(call.addedIds).toEqual(['b'])
    expect(call.removedIds).toEqual(['a'])
    expect(call.nextSelectedIds).toEqual(['b'])
  })

  it('allows selecting a different primary item when primarySupported is enabled', async () => {
    const adapter = buildAdapter()
    const onConfirm = jest.fn(async () => undefined)
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={() => undefined}
        adapter={adapter}
        initialSelectedIds={['a']}
        initialPrimaryId="a"
        primarySupported
        onConfirm={onConfirm}
      />,
    )

    await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(getSearchResultRow('Globex'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Set primary' }))
    })

    const saveButton = screen
      .getAllByRole('button', { name: /Link company/ })
      .find((b) => b.textContent?.includes('Link company'))!
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const call = onConfirm.mock.calls[0][0] as Parameters<typeof onConfirm>[0]
    expect(call.primaryId).toBe('b')
  })

  it('renders computed orphan warning message via fetchDetails adapter behavior', async () => {
    const adapter = buildAdapter({
      kind: 'deal',
      renderPreview: (option) => (
        <div data-testid="preview-card">
          <div>{option.label}</div>
          <div>This deal has no other linked entities.</div>
        </div>
      ),
    })
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={() => undefined}
        adapter={adapter}
        initialSelectedIds={['a']}
        onConfirm={async () => undefined}
      />,
    )
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument())

    const selectedItemButton = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-pressed') === null && button.textContent?.includes('Acme Corp'))
    expect(selectedItemButton).toBeDefined()

    await act(async () => {
      fireEvent.click(selectedItemButton!)
    })

    await waitFor(() =>
      expect(screen.getByText('This deal has no other linked entities.')).toBeInTheDocument(),
    )
  })

  it('opens the nested Add new renderer and auto-selects created option', async () => {
    type AddNewCtx = Parameters<NonNullable<LinkEntityAdapter['addNew']>['render']>[0]
    let latestCtx: AddNewCtx | null = null
    const adapter = buildAdapter({
      addNew: {
        title: 'Add new company',
        subtitle: 'Creates and auto-links',
        render: (ctx) => {
          latestCtx = ctx
          return <div data-testid="nested">Nested</div>
        },
      },
    })
    const onConfirm = jest.fn(async () => undefined)
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={() => undefined}
        adapter={adapter}
        initialSelectedIds={[]}
        onConfirm={onConfirm}
      />,
    )

    const cta = await screen.findByRole('button', { name: /Add new company/ })
    await act(async () => {
      fireEvent.click(cta)
    })

    await waitFor(() => expect(latestCtx).not.toBeNull())

    await act(async () => {
      latestCtx?.onCreated({ id: 'new-id', label: 'New Company', subtitle: null })
    })

    const saveButton = screen.getByRole('button', { name: /Link company/ })
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const call = onConfirm.mock.calls[0][0] as Parameters<typeof onConfirm>[0]
    expect(call.addedIds).toEqual(['new-id'])
  })

  it('disables save button when there are no changes', async () => {
    const adapter = buildAdapter()
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={() => undefined}
        adapter={adapter}
        initialSelectedIds={['a']}
        onConfirm={async () => undefined}
      />,
    )

    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument())
    const saveButton = screen.getByRole('button', { name: /Link company/ })
    expect(saveButton).toBeDisabled()
  })

  it('propagates linkSettings from renderLinkSettings to onConfirm', async () => {
    const adapter = buildAdapter({
      kind: 'person',
      initialLinkSettings: { role: null, isPrimary: false },
      renderLinkSettings: (settings, onChange) => (
        <button
          type="button"
          onClick={() => onChange({ role: 'decision_maker', isPrimary: true })}
        >
          Apply role
        </button>
      ),
    })
    const onConfirm = jest.fn(async () => undefined)
    renderWithProviders(
      <LinkEntityDialog
        open
        onOpenChange={() => undefined}
        adapter={adapter}
        initialSelectedIds={[]}
        onConfirm={onConfirm}
      />,
    )

    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByText('Acme Corp').closest('[role="button"]')!)
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply role' })).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply role' }))
    })

    const saveButton = screen
      .getAllByRole('button', { name: /Link company/ })
      .find((b) => b.textContent?.includes('Link company'))!
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const call = onConfirm.mock.calls[0][0] as Parameters<typeof onConfirm>[0]
    expect(call.linkSettings).toEqual({ role: 'decision_maker', isPrimary: true })
  })
})
