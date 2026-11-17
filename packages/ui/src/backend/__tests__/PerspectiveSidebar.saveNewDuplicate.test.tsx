/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { PerspectiveSidebar, type PerspectiveSidebarProps } from '../PerspectiveSidebar'
import type { PerspectiveDto } from '@open-mercato/shared/modules/perspectives/types'

jest.mock('../FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('../columns/ColumnChooserPanel', () => ({
  ColumnChooserSection: () => null,
}))

jest.mock('../views/ViewChip', () => ({
  ViewChip: (props: { label: string; onClone: () => void }) => (
    <button type="button" onClick={props.onClone}>{`Clone ${props.label}`}</button>
  ),
}))

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
}

const PERSONAL_VIEW: PerspectiveDto = {
  id: 'persp-1',
  name: 'My view',
  tableId: 'test-table',
  settings: { searchValue: 'acme' },
  isDefault: false,
  createdAt: 'now',
  updatedAt: '2026-08-06T00:00:00.000Z',
}

function renderSidebar(onSave: PerspectiveSidebarProps['onSave']) {
  const props: PerspectiveSidebarProps = {
    open: true,
    onOpenChange: () => {},
    loading: false,
    perspectives: [PERSONAL_VIEW],
    rolePerspectives: [],
    roles: [],
    activePerspectiveId: null,
    onActivatePerspective: () => {},
    onDeletePerspective: async () => {},
    onClearRole: async () => {},
    onSave,
    canApplyToRoles: false,
    availableColumns: [],
    visibleColumnKeys: [],
    columnOrder: [],
    onToggleColumn: () => {},
    onReorderColumns: () => {},
    saving: false,
    deletingIds: [],
    roleClearingIds: [],
  }
  return render(
    <I18nProvider locale="en" dict={{ 'ui.perspectives.error.nameExists': 'Translated duplicate name' }}>
      <PerspectiveSidebar {...props} />
    </I18nProvider>,
  )
}

async function submitNewView(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /New/ }))
  fireEvent.change(screen.getByPlaceholderText('View name...'), { target: { value: name } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create view' }))
  })
}

describe('PerspectiveSidebar save-as-new with a taken name', () => {
  it('asks the server to create only and shows the translated duplicate-name error', async () => {
    const duplicate = Object.assign(new Error('A view with this name already exists.'), {
      status: 409,
      code: 'duplicate_name',
    })
    const onSave = jest.fn(async () => {
      throw duplicate
    })
    renderSidebar(onSave)

    await submitNewView('My view')

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My view', perspectiveId: null, createOnly: true }),
    )
    expect(screen.getByText('Translated duplicate name')).toBeTruthy()
    expect(screen.getByPlaceholderText('View name...')).toBeTruthy()
  })

  it('moves a clone on to the next copy number when the server reports the name is taken', async () => {
    const duplicate = Object.assign(new Error('A view with this name already exists.'), {
      status: 409,
      code: 'duplicate_name',
    })
    const onSave = jest
      .fn<Promise<void>, Parameters<PerspectiveSidebarProps['onSave']>>()
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce(undefined)
    renderSidebar(onSave)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clone My view' }))
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'My view (copy)', perspectiveId: null, createOnly: true }),
    )
    expect(onSave).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'My view (copy 2)', perspectiveId: null, createOnly: true }),
    )
    expect(screen.queryByText('Translated duplicate name')).toBeNull()
  })
})


describe('PerspectiveSidebar create submission exclusion', () => {
  it('ignores mouse and keyboard submits while the same creation is in flight', async () => {
    let resolveSave: (() => void) | undefined
    const onSave = jest.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    renderSidebar(onSave)
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    const input = screen.getByPlaceholderText('View name...')
    fireEvent.change(input, { target: { value: 'Free view' } })

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
      fireEvent.click(screen.getByRole('button', { name: 'Create view' }))
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => { resolveSave?.() })
    expect(screen.queryByPlaceholderText('View name...')).toBeNull()
    expect(screen.queryByText('Translated duplicate name')).toBeNull()
  })

  it('allows a corrected keyboard retry after a duplicate refusal', async () => {
    const duplicate = Object.assign(new Error('Taken'), { status: 409, code: 'duplicate_name' })
    const onSave = jest.fn<Promise<void>, Parameters<PerspectiveSidebarProps['onSave']>>()
      .mockRejectedValueOnce(duplicate).mockResolvedValueOnce(undefined)
    renderSidebar(onSave)
    await submitNewView('My view')
    const input = screen.getByPlaceholderText('View name...')
    fireEvent.change(input, { target: { value: 'Corrected view' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }) })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Corrected view' }))
    expect(screen.queryByText('Translated duplicate name')).toBeNull()
    expect(screen.queryByPlaceholderText('View name...')).toBeNull()
  })
})
