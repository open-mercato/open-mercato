/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalUsersPageClient } from '../PortalUsersPageClient'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ actions }: any) => <div>{actions}</div>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: jest.requireActual('@open-mercato/ui/backend/detail/ErrorMessage').ErrorMessage,
  LoadingMessage: jest.requireActual('@open-mercato/ui/backend/detail/LoadingMessage').LoadingMessage,
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(({ operation }: { operation: () => unknown }) => operation()),
    retryLastMutation: jest.fn(),
  }),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const readApiResultOrThrowMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

const currentOrgRole = { id: 'role-current', name: 'Current Buyer' }
const targetOrgRole = { id: 'role-target', name: 'Target Buyer' }

describe('PortalUsersPageClient — create user organization (#5576)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readApiResultOrThrowMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.startsWith('/api/directory/organizations')) {
        return {
          items: [
            { id: 'org-home', name: 'Home Org', selectable: true },
            { id: 'org-target', name: 'Target Org', selectable: true },
          ],
        } as never
      }
      return { items: [], total: 0, totalPages: 1 } as never
    })
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customer_accounts/admin/roles')) {
        const items = url.includes('organizationId=org-target') ? [targetOrgRole] : [currentOrgRole]
        return { ok: true, status: 200, result: { items }, response: new Response() } as never
      }
      return { ok: true, status: 201, result: { ok: true }, response: new Response() } as never
    })
  })

  it('lets the admin pick an organization, loads its roles, and sends organizationId on create', async () => {
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId="org-home" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))

    const organizationSelect = await screen.findByLabelText('Organization')
    await screen.findByRole('option', { name: 'Target Org' })
    expect(screen.getByRole('option', { name: 'Current organization' })).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Current Buyer' })
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/roles?pageSize=100&organizationId=org-home',
    )

    fireEvent.change(organizationSelect, { target: { value: 'org-target' } })

    const targetRoleButton = await screen.findByRole('button', { name: 'Target Buyer' })
    expect(screen.queryByRole('button', { name: 'Current Buyer' })).not.toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/roles?pageSize=100&organizationId=org-target',
    )
    fireEvent.click(targetRoleButton)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@example.com' } })
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Buyer' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123!' } })
    fireEvent.submit(organizationSelect.closest('form')!)

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith('/api/customer_accounts/admin/users', expect.objectContaining({ method: 'POST' }))
    })
    const createCall = apiCallMock.mock.calls.find((call) => call[0] === '/api/customer_accounts/admin/users')!
    expect(JSON.parse(String((createCall[1] as RequestInit).body))).toEqual({
      email: 'buyer@example.com',
      displayName: 'Buyer',
      password: 'Secret123!',
      roleIds: ['role-target'],
      organizationId: 'org-target',
    })
  })

  it('ignores a late role response after the organization changes again', async () => {
    let finishTargetRequest: () => void = () => undefined
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.includes('organizationId=org-target')) {
        return new Promise((resolve) => {
          finishTargetRequest = () => resolve({
            ok: true, status: 200, result: { items: [targetOrgRole] }, response: new Response(),
          } as never)
        })
      }
      return { ok: true, status: 200, result: { items: [currentOrgRole] }, response: new Response() } as never
    })
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId="org-home" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))
    const organizationSelect = await screen.findByLabelText('Organization')
    await screen.findByRole('option', { name: 'Target Org' })
    await screen.findByRole('button', { name: 'Current Buyer' })

    fireEvent.change(organizationSelect, { target: { value: 'org-target' } })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/roles?pageSize=100&organizationId=org-target',
    ))
    fireEvent.change(organizationSelect, { target: { value: '' } })
    await screen.findByRole('button', { name: 'Current Buyer' })
    await act(async () => { finishTargetRequest() })

    expect(screen.getByRole('button', { name: 'Current Buyer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Target Buyer' })).not.toBeInTheDocument()
  })

  it.each(['http', 'network', 'payload'])('retries a %s role-load failure for the selected organization without clearing the form', async (failure) => {
    let targetRequests = 0
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/customer_accounts/admin/users') {
        return { ok: true, status: 201, result: { ok: true }, response: new Response() } as never
      }
      if (url.includes('organizationId=org-target')) {
        targetRequests += 1
        if (targetRequests === 1) {
          if (failure === 'network') throw new TypeError('Network unavailable')
          if (failure === 'payload') return { ok: true, status: 200, result: null, response: new Response() } as never
          return { ok: false, status: 500, result: null, response: new Response(null, { status: 500 }) } as never
        }
        return { ok: true, status: 200, result: { items: [targetOrgRole] }, response: new Response() } as never
      }
      return { ok: true, status: 200, result: { items: [currentOrgRole] }, response: new Response() } as never
    })
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId="org-home" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))
    const organizationSelect = await screen.findByLabelText('Organization')
    await screen.findByRole('option', { name: 'Target Org' })
    fireEvent.click(await screen.findByRole('button', { name: 'Current Buyer' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@example.com' } })
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Buyer' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123!' } })

    fireEvent.change(organizationSelect, { target: { value: 'org-target' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load roles for this organization')
    expect(screen.queryByRole('button', { name: 'Current Buyer' })).not.toBeInTheDocument()
    expect(organizationSelect).toHaveValue('org-target')
    expect(screen.getByLabelText('Email')).toHaveValue('buyer@example.com')
    expect(screen.getByLabelText('Display Name')).toHaveValue('Buyer')
    expect(screen.getByLabelText('Password')).toHaveValue('Secret123!')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    const targetRoleButton = await screen.findByRole('button', { name: 'Target Buyer' })
    expect(targetRoleButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(targetRequests).toBe(2)
    expect(organizationSelect).toHaveValue('org-target')
    expect(screen.getByLabelText('Email')).toHaveValue('buyer@example.com')
    expect(screen.getByLabelText('Display Name')).toHaveValue('Buyer')
    expect(screen.getByLabelText('Password')).toHaveValue('Secret123!')
    fireEvent.click(targetRoleButton)
    fireEvent.submit(organizationSelect.closest('form')!)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/users', expect.objectContaining({ method: 'POST' }),
    ))
    const createCall = apiCallMock.mock.calls.find((call) => call[0] === '/api/customer_accounts/admin/users')!
    expect(JSON.parse(String((createCall[1] as RequestInit).body))).toMatchObject({
      organizationId: 'org-target', roleIds: ['role-target'], email: 'buyer@example.com', displayName: 'Buyer',
    })
  })

  it('shows a valid empty role list without a failure or retry action', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] }, response: new Response() } as never)
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId="org-home" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))

    expect(await screen.findByText('No roles are available for this organization')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows loading without stale roles and ignores a late failure from the previous organization', async () => {
    let failTargetRequest: () => void = () => undefined
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.includes('organizationId=org-target')) {
        return new Promise((resolve) => {
          failTargetRequest = () => resolve({
            ok: false, status: 500, result: null, response: new Response(null, { status: 500 }),
          } as never)
        })
      }
      return { ok: true, status: 200, result: { items: [currentOrgRole] }, response: new Response() } as never
    })
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId="org-home" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))
    const organizationSelect = await screen.findByLabelText('Organization')
    await screen.findByRole('option', { name: 'Target Org' })
    await screen.findByRole('button', { name: 'Current Buyer' })

    fireEvent.change(organizationSelect, { target: { value: 'org-target' } })
    expect(await screen.findByText('Loading roles...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Current Buyer' })).not.toBeInTheDocument()
    fireEvent.change(organizationSelect, { target: { value: '' } })
    await screen.findByRole('button', { name: 'Current Buyer' })
    await act(async () => { failTargetRequest() })

    expect(screen.getByRole('button', { name: 'Current Buyer' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('omits organizationId when the current organization is kept', async () => {
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId="org-home" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))
    const organizationSelect = await screen.findByLabelText('Organization')

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@example.com' } })
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Buyer' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123!' } })
    fireEvent.submit(organizationSelect.closest('form')!)

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith('/api/customer_accounts/admin/users', expect.objectContaining({ method: 'POST' }))
    })
    const createCall = apiCallMock.mock.calls.find((call) => call[0] === '/api/customer_accounts/admin/users')!
    expect(JSON.parse(String((createCall[1] as RequestInit).body))).not.toHaveProperty('organizationId')
  })

  it('requires an explicit organization under an all-organizations selection', async () => {
    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" activeOrganizationId={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))

    const organizationSelect = await screen.findByLabelText('Organization')
    await screen.findByRole('option', { name: 'Target Org' })
    expect(screen.getByRole('option', { name: 'Select an organization' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Current organization' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Current Buyer' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@example.com' } })
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Buyer' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123!' } })
    fireEvent.submit(organizationSelect.closest('form')!)

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('Select an organization for the new user', 'error')
    })
    expect(apiCallMock.mock.calls.some((call) => call[0] === '/api/customer_accounts/admin/users')).toBe(false)
  })
})
