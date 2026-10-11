/** @jest-environment jsdom */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../../i18n/en.json'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { AclEditor, type AclBaseline, type AclData } from '../AclEditor'

function mockApi(acl: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string) => {
    const ok = { ok: true, status: 200, response: new Response() }
    if (url === '/api/auth/features') {
      return {
        ...ok,
        result: {
          items: [
            { id: 'catalog.view', title: 'View catalog', module: 'catalog' },
            { id: 'directory.tenants.manage', title: 'Manage tenants', module: 'directory' },
          ],
          modules: [{ id: 'catalog', title: 'Catalog' }, { id: 'directory', title: 'Directory' }],
        },
      }
    }
    if (url.startsWith('/api/directory/organizations')) return { ...ok, result: { items: [] } }
    return { ...ok, result: acl }
  })
}

function Harness({ value, revision, onChange, onBaselineChange }: {
  value: AclData
  revision: number
  onChange: (data: AclData) => void
  onBaselineChange: (baseline: AclBaseline) => void
}) {
  return (
    <AclEditor
      kind="role"
      targetId="role-1"
      canEditOrganizations
      value={value}
      onChange={onChange}
      onBaselineChange={onBaselineChange}
      valueRevision={revision}
      tenantId="tenant-1"
      preserveOnTenantChange
    />
  )
}

describe('AclEditor — role permission simulation support', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reports the ACL exactly as loaded, before the actor\'s own filtering, with the tenant it was loaded for', async () => {
    mockApi({ isSuperAdmin: false, features: ['catalog.view', 'directory.tenants.manage', 'catalog.view'], organizations: ['org-1'], updatedAt: null })
    const onBaselineChange = jest.fn()
    const onChange = jest.fn()
    renderWithProviders(
      <Harness value={{ isSuperAdmin: false, features: [], organizations: null }} revision={0} onChange={onChange} onBaselineChange={onBaselineChange} />,
      { locale: 'en', dict: enDict },
    )
    await waitFor(() => expect(onBaselineChange).toHaveBeenCalled())
    expect(onBaselineChange).toHaveBeenLastCalledWith({
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      features: ['catalog.view', 'directory.tenants.manage'],
      organizations: ['org-1'],
      updatedAt: null,
    })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ isSuperAdmin: false, features: ['catalog.view'], organizations: ['org-1'] }))
  })

  it('re-initializes from value when the revision changes (a simulated proposal is loaded)', async () => {
    mockApi({ isSuperAdmin: false, features: ['catalog.view'], organizations: null, updatedAt: '2026-10-01T00:00:00.000Z' })
    const onChange = jest.fn()
    const onBaselineChange = jest.fn()
    const view = renderWithProviders(
      <Harness value={{ isSuperAdmin: false, features: [], organizations: null }} revision={0} onChange={onChange} onBaselineChange={onBaselineChange} />,
      { locale: 'en', dict: enDict },
    )
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ isSuperAdmin: false, features: ['catalog.view'], organizations: null }))
    view.rerender(
      <Harness value={{ isSuperAdmin: false, features: ['catalog.view', 'catalog.edit'], organizations: ['org-2'] }} revision={1} onChange={onChange} onBaselineChange={onBaselineChange} />,
    )
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ isSuperAdmin: false, features: ['catalog.view', 'catalog.edit'], organizations: ['org-2'] }))
    expect(onBaselineChange).toHaveBeenCalledTimes(1)
  })
})
