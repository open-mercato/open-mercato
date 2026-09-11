/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { PerspectiveSidebar, type PerspectiveSidebarProps } from '../PerspectiveSidebar'
import type { PerspectiveDto, RolePerspectiveDto } from '@open-mercato/shared/modules/perspectives/types'

const mockFlash = jest.fn()
jest.mock('../FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

// The column chooser owns drag-and-drop sensors jsdom cannot exercise; the stub
// keeps this suite on what is under test — how a column toggle is routed into
// autosave — while still going through the real prop wiring.
jest.mock('../columns/ColumnChooserPanel', () => ({
  ColumnChooserSection: (props: { onToggleColumn: (key: string) => void }) => (
    <button type="button" data-testid="toggle-column" onClick={() => props.onToggleColumn('email')} />
  ),
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

const ROLE_VIEW: RolePerspectiveDto = {
  id: 'role-1',
  name: 'Team view',
  tableId: 'test-table',
  settings: { searchValue: 'acme' },
  isDefault: true,
  createdAt: 'now',
  updatedAt: '2026-08-06T00:00:00.000Z',
  roleId: 'role-sales',
  roleName: 'Sales',
  tenantId: null,
  organizationId: null,
}

function renderSidebar(overrides: Partial<PerspectiveSidebarProps> = {}) {
  const onSave = jest.fn(async () => {})
  const props: PerspectiveSidebarProps = {
    open: true,
    onOpenChange: () => {},
    loading: false,
    perspectives: [PERSONAL_VIEW],
    rolePerspectives: [ROLE_VIEW],
    roles: [],
    activePerspectiveId: null,
    onActivatePerspective: () => {},
    onDeletePerspective: async () => {},
    onClearRole: async () => {},
    onSave,
    canApplyToRoles: false,
    availableColumns: [{ key: 'email', label: 'Email' }],
    visibleColumnKeys: ['email'],
    columnOrder: ['email'],
    onToggleColumn: () => {},
    onReorderColumns: () => {},
    saving: false,
    deletingIds: [],
    roleClearingIds: [],
    ...overrides,
  }
  const utils = render(
    <I18nProvider locale="en" dict={{}}>
      <PerspectiveSidebar {...props} />
    </I18nProvider>,
  )
  const rerenderWith = (next: Partial<PerspectiveSidebarProps>) => {
    utils.rerender(
      <I18nProvider locale="en" dict={{}}>
        <PerspectiveSidebar {...props} {...next} />
      </I18nProvider>,
    )
  }
  return { ...utils, onSave, rerenderWith }
}

function toggleColumn() {
  fireEvent.click(screen.getByTestId('toggle-column'))
}

async function flushAutosave() {
  await act(async () => {
    jest.advanceTimersByTime(500)
  })
}

describe('PerspectiveSidebar autosave with an active role perspective (#5113)', () => {
  beforeEach(() => {
    mockFlash.mockClear()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('warns instead of silently discarding a column change on a shared view', async () => {
    const { onSave } = renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    toggleColumn()
    await flushAutosave()

    expect(onSave).not.toHaveBeenCalled()
    expect(mockFlash).toHaveBeenCalledTimes(1)
    expect(mockFlash).toHaveBeenCalledWith(
      expect.stringContaining('Shared views do not save automatically'),
      'warning',
    )
  })

  it('debounces the warning across a burst of toggles', async () => {
    renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    toggleColumn()
    toggleColumn()
    await flushAutosave()

    expect(mockFlash).toHaveBeenCalledTimes(1)
  })

  it('still autosaves into an active personal view', async () => {
    const { onSave } = renderSidebar({ activePerspectiveId: PERSONAL_VIEW.id })

    toggleColumn()
    await flushAutosave()

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      perspectiveId: PERSONAL_VIEW.id,
      name: PERSONAL_VIEW.name,
    }))
  })

  it('drops a pending warning when the user switches to a personal view first', async () => {
    // The warning names the shared view the edit was made on. Firing it after the
    // user has already moved to a personal view would warn about a view they are
    // no longer editing, which is its own kind of misinformation.
    const { rerenderWith } = renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    toggleColumn()
    rerenderWith({ activePerspectiveId: PERSONAL_VIEW.id })
    await flushAutosave()

    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('stays silent when no view is active', async () => {
    const { onSave } = renderSidebar({ activePerspectiveId: null })

    toggleColumn()
    await flushAutosave()

    expect(onSave).not.toHaveBeenCalled()
    expect(mockFlash).not.toHaveBeenCalled()
  })
})

describe('PerspectiveSidebar new-view mode affordances (#5113)', () => {
  beforeEach(() => {
    mockFlash.mockClear()
  })

  it('explains why the create control is inert while the name is blank', () => {
    renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    const confirm = screen.getByRole('button', { name: 'Create view' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('title', 'Enter a name to create the view')
    expect(screen.getByText('Enter a name to create the view')).toBeInTheDocument()
  })

  it('keeps the hint out of the box that centres the confirm/cancel buttons', () => {
    // The buttons are `top-1/2 -translate-y-1/2` against their positioning
    // context, so a hint sharing that box grows it and drags them out of the
    // input. jsdom has no layout engine, so assert the structure that causes it.
    renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    const confirm = screen.getByRole('button', { name: 'Create view' })
    const positioningContext = confirm.closest('.relative') as HTMLElement
    const hint = screen.getByText('Enter a name to create the view')
    expect(positioningContext).not.toBeNull()
    expect(positioningContext.contains(hint)).toBe(false)
  })

  it('keeps the hint mounted once a name is typed, so nothing reflows mid-edit', () => {
    renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByPlaceholderText('View name...'), { target: { value: 'Q1' } })

    const hint = screen.getByText('Enter a name to create the view')
    expect(hint).toBeInTheDocument()
    expect(hint.className).toContain('invisible')
    expect(screen.getByRole('button', { name: 'Create view' })).toBeEnabled()
  })

  it('drops the active-view highlight while the new-view form is open', () => {
    renderSidebar({ activePerspectiveId: ROLE_VIEW.id })

    const chip = screen.getByRole('button', { name: ROLE_VIEW.name }).parentElement as HTMLElement
    expect(chip.className).toContain('border-brand-violet/30')

    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    expect(chip.className).not.toContain('border-brand-violet/30')
  })
})
