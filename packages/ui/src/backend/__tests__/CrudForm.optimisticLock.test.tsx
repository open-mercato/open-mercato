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
import { dismissRecordConflict, getRecordConflictForTest } from '../conflicts'

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

  it('surfaces the localized record-modified message on the unified conflict bar (not a raw-token toast) on stale saves', async () => {
    dismissRecordConflict()
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
      const entry = getRecordConflictForTest()
      expect(entry).not.toBeNull()
      expect(entry?.message).toBe('This record was modified by someone else. Refresh and try again.')
    })
    // The conflict bar is the surface — no transient toast for the conflict.
    expect(flashMock).not.toHaveBeenCalledWith('record_modified', 'error')
    expect(flashMock).not.toHaveBeenCalledWith(
      'This record was modified by someone else. Refresh and try again.',
      'error',
    )
  })
})

type AutoFormValues = { displayName: string; id?: string; updatedAt?: string | null; updated_at?: string | null }

function renderAutoForm(opts: {
  initialValues: Partial<AutoFormValues>
  onSubmit: jest.Mock
  optimisticLockUpdatedAt?: string | null
  disableOptimisticLock?: boolean
  passProp?: boolean
}) {
  const props: Record<string, unknown> = {
    fields,
    initialValues: opts.initialValues,
    onSubmit: opts.onSubmit,
  }
  if (opts.passProp) props.optimisticLockUpdatedAt = opts.optimisticLockUpdatedAt
  if (opts.disableOptimisticLock !== undefined) props.disableOptimisticLock = opts.disableOptimisticLock
  return renderWithProviders(
    <CrudForm<AutoFormValues> {...(props as any)} />,
    { dict },
  )
}

async function submitAuto(container: HTMLElement) {
  const form = container.querySelector('form') as HTMLFormElement
  expect(form).not.toBeNull()
  await act(async () => { fireEvent.submit(form) })
}

function sentLockHeaderValue(): string | undefined {
  const call = withScopedApiRequestHeadersMock.mock.calls.find(
    (c) => c[0] && Object.prototype.hasOwnProperty.call(c[0], OPTIMISTIC_LOCK_HEADER_NAME),
  )
  return call ? call[0][OPTIMISTIC_LOCK_HEADER_NAME] : undefined
}

describe('CrudForm — optimistic-lock auto-derive from initialValues.updatedAt (no prop)', () => {
  beforeEach(() => {
    flashMock.mockClear()
    withScopedApiRequestHeadersMock.mockClear()
    fetchCustomFieldFormStructureMock.mockResolvedValue({
      fields: [], definitions: [], metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
    })
  })

  it('edit mode: derives the header from initialValues.updatedAt when the prop is absent', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { id: 'rec-1', displayName: 'old', updatedAt: '2026-05-25T08:00:00.000Z' }, onSubmit })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBe('2026-05-25T08:00:00.000Z')
  })

  it('edit mode: falls back to snake_case updated_at', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { id: 'rec-1', displayName: 'old', updated_at: '2026-05-25T09:00:00.000Z' }, onSubmit })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBe('2026-05-25T09:00:00.000Z')
  })

  it('edit mode: no updatedAt anywhere → no header attached (no crash)', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { id: 'rec-1', displayName: 'old' }, onSubmit })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBeUndefined()
  })

  it('genuine create (no id, no updatedAt): never attaches', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { displayName: 'new' }, onSubmit })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBeUndefined()
  })

  it('attaches from updatedAt even when form values lack an id (edit page tracks the record id outside form values, e.g. catalog product)', async () => {
    // Regression guard: presence of a loaded updatedAt — not CrudForm's
    // create/update heuristic — drives the header. The catalog product edit page
    // keeps productId out of form values, so a previous operation-gated version
    // silently dropped the header here.
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { displayName: 'old', updatedAt: '2026-05-25T08:00:00.000Z' }, onSubmit })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBe('2026-05-25T08:00:00.000Z')
  })

  it('explicit optimisticLockUpdatedAt={null} wins over auto-derive (no header)', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { id: 'rec-1', displayName: 'old', updatedAt: '2026-05-25T08:00:00.000Z' }, onSubmit, passProp: true, optimisticLockUpdatedAt: null })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBeUndefined()
  })

  it('explicit prop value wins over initialValues.updatedAt', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { id: 'rec-1', displayName: 'old', updatedAt: '2026-05-25T08:00:00.000Z' }, onSubmit, passProp: true, optimisticLockUpdatedAt: '2026-05-25T10:00:00.000Z' })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBe('2026-05-25T10:00:00.000Z')
  })

  it('disableOptimisticLock never attaches even when updatedAt present', async () => {
    const onSubmit = jest.fn(async () => undefined)
    const { container } = renderAutoForm({ initialValues: { id: 'rec-1', displayName: 'old', updatedAt: '2026-05-25T08:00:00.000Z' }, onSubmit, disableOptimisticLock: true })
    await submitAuto(container)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(sentLockHeaderValue()).toBeUndefined()
  })
})
