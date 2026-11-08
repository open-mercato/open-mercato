/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CustomerRoleDetailPage from '../page'

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
})
