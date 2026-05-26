/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import CreateApiKeyPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const mockPush = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

type CapturedField = { id: string; loadOptions?: (query?: string) => Promise<unknown> }
let capturedFields: CapturedField[] = []

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: any) => {
    capturedFields = Array.isArray(props.fields) ? props.fields : []
    return <div data-testid="crud-form-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
}))

jest.mock('@open-mercato/core/modules/directory/components/OrganizationSelect', () => ({
  OrganizationSelect: () => null,
}))

jest.mock('@open-mercato/core/modules/auth/backend/users/roleOptions', () => ({
  fetchRoleOptions: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ tenantId: null, organizationId: null }),
  useOrganizationScopeVersion: () => 0,
}))

function findLoadRoleOptions(): ((query?: string) => Promise<unknown>) | undefined {
  const rolesField = capturedFields.find((field) => field.id === 'roles')
  return rolesField?.loadOptions
}

describe('CreateApiKeyPage — role selector tenant scoping (#1556)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = []
  })

  it('returns empty options and skips fetchRoleOptions until actor-resolution completes', async () => {
    let resolveActor: (value: any) => void = () => {}
    const actorResolution = new Promise<any>((resolve) => {
      resolveActor = resolve
    })
    ;(apiCall as jest.Mock).mockImplementation(() => actorResolution)
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([
      { value: 'role-a', label: 'Role A' },
    ])

    render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))

    const loadRoleOptions = findLoadRoleOptions()
    expect(typeof loadRoleOptions).toBe('function')

    // Before the actor-resolution promise settles, the loader MUST return []
    // and MUST NOT invoke fetchRoleOptions — otherwise an unscoped query could
    // leak roles from other tenants when the real caller is a super admin.
    const earlyResult = await loadRoleOptions!()
    expect(earlyResult).toEqual([])
    expect(fetchRoleOptions).not.toHaveBeenCalled()

    // Resolve the actor as a non-super admin. Once the resolution finishes,
    // the loader is allowed to hit the roles endpoint (without tenantId for
    // non-super-admin callers, matching server-side scoping rules).
    await act(async () => {
      resolveActor({ ok: true, result: { tenantId: 'tenant-1', isSuperAdmin: false } })
      await actorResolution
    })

    await waitFor(() => {
      const latest = findLoadRoleOptions()
      expect(latest).not.toBe(loadRoleOptions)
    })

    const resolvedLoader = findLoadRoleOptions()!
    await resolvedLoader()
    expect(fetchRoleOptions).toHaveBeenCalledTimes(1)
    expect(fetchRoleOptions).toHaveBeenCalledWith(undefined)
  })

  it('still blocks the initial call when actor resolution fails (error branch sets actorResolved)', async () => {
    let rejectActor: (reason: unknown) => void = () => {}
    const actorResolution = new Promise<any>((_resolve, reject) => {
      rejectActor = reject
    })
    ;(apiCall as jest.Mock).mockImplementation(() => actorResolution)
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([])

    render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))

    const earlyLoader = findLoadRoleOptions()!
    expect(await earlyLoader()).toEqual([])
    expect(fetchRoleOptions).not.toHaveBeenCalled()

    await act(async () => {
      rejectActor(new Error('boom'))
      await actorResolution.catch(() => {})
    })

    // After the finally-block flips actorResolved, a fresh loader closure
    // must be produced and the fallback branch is allowed to run.
    await waitFor(() => {
      const latest = findLoadRoleOptions()
      expect(latest).not.toBe(earlyLoader)
    })

    const recoveredLoader = findLoadRoleOptions()!
    await recoveredLoader()
    expect(fetchRoleOptions).toHaveBeenCalledTimes(1)
  })
})
