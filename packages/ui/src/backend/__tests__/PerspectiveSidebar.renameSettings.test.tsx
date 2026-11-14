/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { PerspectiveDto } from '@open-mercato/shared/modules/perspectives/types'
import { PerspectiveSidebar, type PerspectiveSidebarProps } from '../PerspectiveSidebar'

const mockFlash = jest.fn()
jest.mock('../FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('../columns/ColumnChooserPanel', () => ({ ColumnChooserSection: () => null }))

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <Value,>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value
}

const savedView: PerspectiveDto = {
  id: 'saved-view',
  name: 'Saved view',
  tableId: 'customers.people.list',
  settings: {
    pageSize: 40,
    columnOrder: ['email', 'name'],
    columnVisibility: { name: true, email: false },
    columnSizing: { name: 240 },
    filters: { v: 2, root: { id: 'saved-root', type: 'group', combinator: 'and', children: [{ id: 'saved-rule', type: 'rule', field: 'name', operator: 'contains', value: 'saved filter' }] } },
    sorting: [{ id: 'name', desc: true }],
    searchValue: 'saved search',
  },
  isDefault: false,
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
}

function renderSidebar(activePerspectiveId: string | null, save?: PerspectiveSidebarProps['onSave']) {
  const occupiedView = { ...savedView, id: 'occupied-view', name: 'Taken name', settings: { pageSize: 10 } }
  const persistedView = structuredClone(savedView)
  const onSave = jest.fn<Promise<void>, Parameters<PerspectiveSidebarProps['onSave']>>(async (input) => {
    if (save) return save(input)
    persistedView.name = input.name
    persistedView.settings = input.settings ?? { columnOrder: ['name'], columnVisibility: { name: true } }
  })
  render(
    <I18nProvider locale="en" dict={{}}>
      <PerspectiveSidebar
        open
        onOpenChange={() => {}}
        loading={false}
        perspectives={[savedView, occupiedView]}
        rolePerspectives={[]}
        roles={[]}
        activePerspectiveId={activePerspectiveId}
        onActivatePerspective={() => {}}
        onDeletePerspective={async () => {}}
        onClearRole={async () => {}}
        onSave={onSave}
        canApplyToRoles={false}
        availableColumns={[]}
        visibleColumnKeys={['name']}
        columnOrder={['name']}
        onToggleColumn={() => {}}
        onReorderColumns={() => {}}
        saving={false}
        deletingIds={[]}
        roleClearingIds={[]}
      />
    </I18nProvider>,
  )
  return { persistedView, onSave }
}

describe('PerspectiveSidebar name-only rename', () => {
  beforeEach(() => { mockFlash.mockClear() })

  it.each([savedView.id, 'occupied-view'])('preserves all saved settings when active view is %s', async (activeId) => {
    const { persistedView, onSave } = renderSidebar(activeId)
    fireEvent.click(screen.getAllByRole('button', { name: 'View options' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Rename', exact: true }))
    const input = screen.getByDisplayValue(savedView.name)
    fireEvent.change(input, { target: { value: 'Taken name' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }) })
    expect(onSave).not.toHaveBeenCalled()
    expect(persistedView).toEqual(savedView)
    expect(mockFlash).toHaveBeenCalledWith(expect.stringContaining('already exists'), 'error')

    fireEvent.change(input, { target: { value: 'Corrected name' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(persistedView).toEqual({ ...savedView, name: 'Corrected name' })
    expect(screen.queryByDisplayValue('Corrected name')).toBeNull()
  })
})


describe('PerspectiveSidebar rename submission lifecycle', () => {
  const openRename = () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'View options' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Rename', exact: true }))
    const input = screen.getByDisplayValue(savedView.name)
    fireEvent.change(input, { target: { value: 'Renamed view' } })
    return input
  }

  const submitBurst = (interaction: string, input: HTMLElement) => {
    if (interaction === 'mouse') {
      const confirm = screen.getByRole('button', { name: 'Confirm rename' })
      fireEvent.click(confirm)
      fireEvent.click(confirm)
      return
    }
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  }

  it.each(['mouse', 'keyboard'])('coalesces overlapping %s rename submissions without a false failure', async (interaction) => {
    let finishSave: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => { finishSave = resolve })
    let attempts = 0
    const { onSave } = renderSidebar(savedView.id, async () => {
      attempts += 1
      if (attempts > 1) throw new Error('[internal] Stale overlapping rename')
      await pendingSave
    })
    const input = openRename()
    await act(async () => { submitBurst(interaction, input) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Renamed view', perspectiveId: savedView.id, settings: savedView.settings,
    }))
    await act(async () => { finishSave?.(); await pendingSave })
    expect(screen.queryByDisplayValue('Renamed view')).toBeNull()
    expect(screen.queryByText('[internal] Stale overlapping rename')).toBeNull()
  })

  it.each(['mouse', 'keyboard'])('allows corrected %s retry after a genuine rejection', async (interaction) => {
    let attempts = 0
    const { onSave } = renderSidebar(savedView.id, async () => {
      attempts += 1
      if (attempts === 1) throw new Error('[internal] Rename rejected')
    })
    const input = openRename()
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }) })
    expect(screen.getByText('[internal] Rename rejected')).toBeVisible()
    expect(input).toHaveValue('Renamed view')
    fireEvent.change(input, { target: { value: 'Corrected retry' } })
    await act(async () => { submitBurst(interaction, input) })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'Corrected retry', perspectiveId: savedView.id, settings: savedView.settings,
    }))
    expect(screen.queryByDisplayValue('Corrected retry')).toBeNull()
    expect(screen.queryByText('[internal] Rename rejected')).toBeNull()
  })
})
