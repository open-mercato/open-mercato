/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CustomerRoleDetailPage from '../backend/customer_accounts/roles/[id]/page'

const mockApiCall = jest.fn()
const mockReadRole = jest.fn()
const mockPush = jest.fn()
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

type PermissionProps = {
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
}

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ groups, initialValues, onSubmit }: {
    groups: Array<{ id: string; component?: React.ComponentType<PermissionProps> }>
    initialValues: Record<string, unknown>
    onSubmit: (values: Record<string, unknown>) => Promise<void>
  }) => {
    const [values, setValues] = React.useState(initialValues)
    const Permissions = groups.find((group) => group.id === 'permissions')?.component
    return (
      <form onSubmit={(event) => { event.preventDefault(); void onSubmit(values) }}>
        {Permissions ? <Permissions values={values} setValue={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))} /> : null}
        <button type="submit">Save</button>
      </form>
    )
  },
}))
jest.mock('@open-mercato/ui/primitives/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean | 'indeterminate'; onCheckedChange: () => void }) => (
    <input type="checkbox" checked={checked === true} onChange={onCheckedChange} />
  ),
}))
jest.mock('@open-mercato/ui/primitives/button', () => ({ Button: () => null }))
jest.mock('@open-mercato/ui/primitives/spinner', () => ({ Spinner: () => null }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ RecordNotFoundState: () => null, ErrorMessage: () => null }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadRole(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

describe('customer role warranty permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReadRole.mockResolvedValue({
      id: 'role-1', name: 'Claims viewer', slug: 'claims-viewer', description: null,
      isDefault: false, isSystem: false, customerAssignable: false,
      features: ['portal.orders.view', 'portal.custom.existing'],
    })
    mockApiCall.mockResolvedValue({ ok: true, result: { updatedAt: '2026-11-16T00:00:00Z' } })
  })

  it('allows granting warranty permissions without discarding existing grants', async () => {
    render(<CustomerRoleDetailPage params={{ id: 'role-1' }} />)
    const view = await screen.findByRole('checkbox', { name: /View warranty claims/ })
    const manage = screen.getByRole('checkbox', { name: /Manage warranty claims/ })
    expect((view as HTMLInputElement).checked).toBe(false)
    expect((manage as HTMLInputElement).checked).toBe(false)
    fireEvent.click(view)
    fireEvent.click(manage)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/roles/role-1/acl',
      expect.objectContaining({ body: JSON.stringify({ features: ['portal.orders.view', 'portal.custom.existing', 'portal.warranty_claims.view', 'portal.warranty_claims.manage'] }) }),
    ))
  })

  it('allows revoking warranty management while retaining view and unrelated grants', async () => {
    mockReadRole.mockResolvedValue({
      id: 'role-1', name: 'Claims manager', slug: 'claims-manager', description: null,
      isDefault: false, isSystem: false, customerAssignable: false,
      features: ['portal.orders.view', 'portal.warranty_claims.view', 'portal.warranty_claims.manage'],
    })
    render(<CustomerRoleDetailPage params={{ id: 'role-1' }} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /Manage warranty claims/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/roles/role-1/acl',
      expect.objectContaining({ body: JSON.stringify({ features: ['portal.orders.view', 'portal.warranty_claims.view'] }) }),
    ))
  })
})
