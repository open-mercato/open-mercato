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
})
