/** @jest-environment jsdom */

import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const buildFormFieldFromCustomFieldDefMock = jest.fn()
const fetchCustomFieldFormStructureMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn(async (_headers: Record<string, string>, fn: () => Promise<unknown>) => fn())
const flashMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))
jest.mock('../custom-fields/FieldDefinitionsManager', () => {
  const React = require('react')
  return {
    __esModule: true,
    FieldDefinitionsManager: React.forwardRef(() => <div>Field definitions manager</div>),
  }
})
jest.mock('../utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: (...args: unknown[]) => buildFormFieldFromCustomFieldDefMock(...args),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: (...args: unknown[]) => fetchCustomFieldFormStructureMock(...args),
}))
jest.mock('../utils/apiCall', () => {
  const actual = jest.requireActual('../utils/apiCall')
  return {
    ...actual,
    withScopedApiRequestHeaders: (...args: unknown[]) =>
      withScopedApiRequestHeadersMock(
        args[0] as Record<string, string>,
        args[1] as () => Promise<unknown>,
      ),
  }
})
jest.mock('../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = {
  'ui.forms.actions.save': 'Save',
  'ui.forms.flash.recordModified': 'This record was modified by someone else. Refresh and try again.',
}

const fields: CrudField[] = [
  { id: 'displayName', label: 'Display name', type: 'text' },
]

function renderForm(opts: {
  optimisticLockUpdatedAt?: string | null
  onSubmit: jest.Mock
}) {
  return renderWithProviders(
    <CrudForm<{ displayName: string; id?: string }>
      fields={fields}
      initialValues={{ id: 'rec-1', displayName: 'old' }}
      onSubmit={opts.onSubmit}
      optimisticLockUpdatedAt={opts.optimisticLockUpdatedAt}
    />,
    { dict },
  )
}

describe('CrudForm — optimisticLockUpdatedAt prop wiring', () => {
  beforeEach(() => {
    flashMock.mockClear()
    withScopedApiRequestHeadersMock.mockClear()
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [],
      definitions: [],
      metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
    })
  })

  it('wraps onSubmit in withScopedApiRequestHeaders carrying the extension header when prop is set', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderForm({ optimisticLockUpdatedAt: '2026-05-25T08:42:18.123Z', onSubmit })
    const form = container.querySelector('form') as HTMLFormElement
    expect(form).not.toBeNull()
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    const headerArg = withScopedApiRequestHeadersMock.mock.calls[0][0]
    expect(headerArg).toEqual({
      [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-05-25T08:42:18.123Z',
    })
  })

  it('does NOT wrap when optimisticLockUpdatedAt is omitted (no injection headers either)', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderForm({ optimisticLockUpdatedAt: undefined, onSubmit })
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(withScopedApiRequestHeadersMock).not.toHaveBeenCalled()
  })

  it('does NOT wrap when optimisticLockUpdatedAt is an empty string', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderForm({ optimisticLockUpdatedAt: '', onSubmit })
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(withScopedApiRequestHeadersMock).not.toHaveBeenCalled()
  })

  it('does NOT wrap when optimisticLockUpdatedAt is null', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderForm({ optimisticLockUpdatedAt: null, onSubmit })
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(withScopedApiRequestHeadersMock).not.toHaveBeenCalled()
  })

  it('shows the localized record-modified message instead of the raw server error token on stale saves', async () => {
    const conflict = Object.assign(new Error('record_modified'), {
      status: 409,
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:42:19.000Z',
      expectedUpdatedAt: '2026-05-25T08:42:18.000Z',
    })
    const onSubmit = jest.fn(async () => {
      throw conflict
    })
    const { container } = renderForm({ optimisticLockUpdatedAt: '2026-05-25T08:42:18.000Z', onSubmit })
    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.submit(form)
    })

    await waitFor(() => {
      expect(flashMock).toHaveBeenCalledWith(
        'This record was modified by someone else. Refresh and try again.',
        'error',
      )
    })
    expect(flashMock).not.toHaveBeenCalledWith('record_modified', 'error')
  })
})
