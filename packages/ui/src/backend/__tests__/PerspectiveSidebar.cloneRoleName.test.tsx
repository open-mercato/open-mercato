/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { PerspectiveDto, RolePerspectiveDto } from '@open-mercato/shared/modules/perspectives/types'
import { PerspectiveSidebar, type PerspectiveSidebarProps } from '../PerspectiveSidebar'
import { buildCloneName, collectTakenCloneNames, findFreeCloneNumber } from '../views/cloneName'

jest.mock('../FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../columns/ColumnChooserPanel', () => ({ ColumnChooserSection: () => null }))

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <Value,>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value
}

const ROLE_ID = 'role-sales'
const OTHER_ROLE_ID = 'role-support'

function roleView(overrides: Partial<RolePerspectiveDto>): RolePerspectiveDto {
  return {
    id: 'role-view',
    name: 'Pipeline',
    tableId: 'customers.deals',
    settings: { pageSize: 25 },
    isDefault: false,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    roleId: ROLE_ID,
    tenantId: null,
    organizationId: null,
    roleName: 'Sales',
    ...overrides,
  }
}

describe('clone name helpers (#8632)', () => {
  it('builds copy names the same way as before', () => {
    expect(buildCloneName('Pipeline', 1)).toBe('Pipeline (copy)')
    expect(buildCloneName('Pipeline', 3)).toBe('Pipeline (copy 3)')
  })

  it('treats names of target role views as taken, but not names of unrelated roles', () => {
    const taken = collectTakenCloneNames(
      [{ name: 'Mine' }],
      [
        { name: 'Pipeline (copy)', roleId: ROLE_ID },
        { name: 'Pipeline (copy 2)', roleId: OTHER_ROLE_ID },
      ],
      [ROLE_ID],
    )
    expect(Array.from(taken).sort()).toEqual(['Mine', 'Pipeline (copy)'])
  })

  it('skips copy numbers used by personal views and target role views', () => {
    const taken = new Set(['Pipeline (copy)', 'Pipeline (copy 2)', 'Pipeline (copy 4)'])
    expect(findFreeCloneNumber('Pipeline', taken)).toBe(3)
    expect(findFreeCloneNumber('Pipeline', taken, 4)).toBe(5)
  })
})

describe('PerspectiveSidebar clone of a shared view (#8632)', () => {
  it('picks the next copy number free in personal views and the target role views', async () => {
    const source = roleView({ id: 'source-role-view', name: 'Pipeline' })
    const roleCopy = roleView({ id: 'role-copy', name: 'Pipeline (copy)', settings: { pageSize: 50 } })
    const personalCopy: PerspectiveDto = {
      id: 'personal-copy',
      name: 'Pipeline (copy 2)',
      tableId: 'customers.deals',
      settings: { pageSize: 10 },
      isDefault: false,
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
    }
    const onSave = jest.fn<Promise<void>, Parameters<PerspectiveSidebarProps['onSave']>>(async () => undefined)
    render(
      <I18nProvider locale="en" dict={{}}>
        <PerspectiveSidebar
          open
          onOpenChange={() => {}}
          loading={false}
          perspectives={[personalCopy]}
          rolePerspectives={[source, roleCopy]}
          roles={[]}
          activePerspectiveId={null}
          onActivatePerspective={() => {}}
          onDeletePerspective={async () => {}}
          onClearRole={async () => {}}
          onSave={onSave}
          canApplyToRoles
          availableColumns={[]}
          visibleColumnKeys={[]}
          columnOrder={[]}
          onToggleColumn={() => {}}
          onReorderColumns={() => {}}
          saving={false}
          deletingIds={[]}
          roleClearingIds={[]}
        />
      </I18nProvider>,
    )

    const optionButtons = screen.getAllByRole('button', { name: 'View options' })
    fireEvent.click(optionButtons[1])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Pipeline (copy 3)',
      applyToRoles: [ROLE_ID],
      createOnly: true,
    })
  })
})
