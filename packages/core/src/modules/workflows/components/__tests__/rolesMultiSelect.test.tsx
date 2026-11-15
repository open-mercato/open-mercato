/**
 * @jest-environment jsdom
 *
 * Step 5.1 (#4239): user-task role assignment uses a roles multiselect fed by
 * GET /api/auth/roles instead of a comma-separated free-text input. The component
 * must render fetched role options as suggestions, degrade to free-text chip entry
 * when the lookup fails (403 for editors without auth.roles.list, network error),
 * and never drop stored values that are missing from the fetched options.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RolesMultiSelect } from '../fields/RolesMultiSelect'
import { NodeEditDialogCrudForm } from '../NodeEditDialogCrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/workflows',
}))

const apiCallMock = apiCall as jest.Mock

const PLACEHOLDER_KEY = 'workflows.rolesSelect.placeholder'
const LOOKUP_UNAVAILABLE_KEY = 'workflows.rolesSelect.lookupUnavailable'

function mockRolesResponse(names: string[]) {
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: { items: names.map((name, index) => ({ id: `role-${index}`, name })) },
    response: {},
    cacheStatus: null,
  })
}

function mockRolesForbidden() {
  apiCallMock.mockResolvedValue({
    ok: false,
    status: 403,
    result: null,
    response: {},
    cacheStatus: null,
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('RolesMultiSelect', () => {
  it('renders fetched role options as suggestions and selects one', async () => {
    mockRolesResponse(['Manager', 'Reviewer'])
    const onChange = jest.fn()
    renderWithProviders(<RolesMultiSelect value={[]} onChange={onChange} />)

    const input = screen.getByPlaceholderText(PLACEHOLDER_KEY)
    fireEvent.focus(input)

    const managerOption = await screen.findByRole('button', { name: 'Manager' })
    expect(apiCallMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/roles?page=1&pageSize=100'),
      { headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
      expect.anything(),
    )
    fireEvent.click(managerOption)

    expect(onChange).toHaveBeenCalledWith(['Manager'])
  })

  it('degrades to free-text entry when the role lookup returns 403 and suppresses the global forbidden redirect', async () => {
    mockRolesForbidden()
    const onChange = jest.fn()
    renderWithProviders(<RolesMultiSelect value={[]} onChange={onChange} />)

    const input = screen.getByPlaceholderText(PLACEHOLDER_KEY)
    fireEvent.focus(input)

    await waitFor(() => {
      expect(screen.getByText(LOOKUP_UNAVAILABLE_KEY)).toBeInTheDocument()
    })

    expect(apiCallMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/roles'),
      { headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
      expect.anything(),
    )

    fireEvent.change(input, { target: { value: 'legacy_role' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(['legacy_role'])
  })

  it('keeps stored values missing from fetched options as removable chips', async () => {
    mockRolesResponse(['Manager'])
    const onChange = jest.fn()
    renderWithProviders(<RolesMultiSelect value={['ancient_role']} onChange={onChange} />)

    expect(screen.getByText('ancient_role')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove ancient_role' }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('NodeEditDialogCrudForm — roles multiselect adoption (#4239)', () => {
  it('renders assignedToRoles through RolesMultiSelect with stored roles as chips', () => {
    mockRolesResponse(['Manager'])
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={{
          id: 'task-1',
          type: 'userTask',
          data: { assignedToRoles: ['Manager', 'legacy_role'] },
        } as any}
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    )

    expect(screen.getByPlaceholderText(PLACEHOLDER_KEY)).toBeInTheDocument()
    expect(screen.getByText('Manager')).toBeInTheDocument()
    expect(screen.getByText('legacy_role')).toBeInTheDocument()
  })
})
