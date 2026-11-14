/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CustomerRoleDetailPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const readApiResultOrThrowMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

type CapturedCrudFormProps = {
  initialValues?: Record<string, unknown>
  onDelete?: () => Promise<void> | void
  onSubmit?: (values: Record<string, unknown>) => Promise<void>
}

const crudFormPropsCapture: { current: CapturedCrudFormProps | null } = { current: null }

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedCrudFormProps) => {
    crudFormPropsCapture.current = props
    return <div data-testid="crud-form" />
  },
}))

async function renderRolePage(id: string): Promise<CapturedCrudFormProps> {
  crudFormPropsCapture.current = null
  renderWithProviders(<CustomerRoleDetailPage params={{ id }} />)
  await waitFor(() => {
    expect(crudFormPropsCapture.current).not.toBeNull()
  })
  return crudFormPropsCapture.current!
}

describe('customer role detail page Delete control (issue #9009)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(apiCall).mockReset()
    readApiResultOrThrowMock.mockReset()
  })

  it('carries the persisted record id in initialValues so CrudForm shows Delete for a non-default role', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      id: 'role-123',
      name: 'Billing managers',
      slug: 'billing-managers',
      description: null,
      isDefault: false,
      isSystem: false,
      customerAssignable: true,
      features: [],
      updatedAt: '2026-05-01T00:00:00.000Z',
    })

    const props = await renderRolePage('role-123')

    expect(props.initialValues?.id).toBe('role-123')
    expect(props.onDelete).toBeInstanceOf(Function)
  })

  it('still omits onDelete for a default role regardless of the record id fix', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      id: 'role-default',
      name: 'Default role',
      slug: 'default-role',
      description: null,
      isDefault: true,
      isSystem: false,
      customerAssignable: true,
      features: [],
      updatedAt: '2026-05-01T00:00:00.000Z',
    })

    const props = await renderRolePage('role-default')

    expect(props.initialValues?.id).toBe('role-default')
    expect(props.onDelete).toBeUndefined()
  })

  it.each([400, 409])('rejects a refused delete and retry with HTTP%s so CrudForm cannot announce success', async (status) => {
    readApiResultOrThrowMock.mockResolvedValue({ id: 'role-123', name: 'Assigned role', features: [], isDefault: false })
    const body = status === 409
      ? { code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-05-02T00:00:00.000Z', expectedUpdatedAt: '2026-05-01T00:00:00.000Z' }
      : { error: 'Role has assigned users' }
    jest.mocked(apiCall).mockImplementation(async () => ({
      ok: false, status, result: body,
      response: { status, text: async () => JSON.stringify(body) } as Response,
      cacheStatus: null,
    }))
    const props = await renderRolePage('role-123')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(props.onDelete?.()).rejects.toMatchObject({ status, ...body })
    }
    expect(flash).not.toHaveBeenCalled()
  })

  it.each(['role', 'acl'])('rejects the failed %s save instead of completing the form lifecycle', async (failure) => {
    readApiResultOrThrowMock.mockResolvedValue({ id: 'role-123', name: 'Assigned role', features: [], isDefault: false })
    const rejected = {
      ok: false, status: 400, result: { error: 'Save refused' },
      response: { status: 400, text: async () => JSON.stringify({ error: 'Save refused' }) } as Response,
      cacheStatus: null,
    }
    if (failure === 'acl') {
      jest.mocked(apiCall).mockResolvedValueOnce({ ok: true, status: 200, result: {}, response: {} as Response, cacheStatus: null })
    }
    jest.mocked(apiCall).mockResolvedValueOnce(rejected)
    const props = await renderRolePage('role-123')
    await expect(props.onSubmit?.({ name: 'Changed name', features: [] })).rejects.toMatchObject({ status: 400 })
    expect(apiCall).toHaveBeenCalledTimes(failure === 'role' ? 1 : 2)
    expect(flash).not.toHaveBeenCalled()
  })
})
