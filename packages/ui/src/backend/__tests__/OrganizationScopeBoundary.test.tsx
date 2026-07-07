/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { OrganizationScopeBoundary } from '../OrganizationScopeBoundary'

let mountCount = 0

function MountCounter() {
  React.useEffect(() => {
    mountCount += 1
  }, [])
  return <span data-testid="child">child</span>
}

describe('<OrganizationScopeBoundary>', () => {
  beforeEach(() => {
    mountCount = 0
  })

  it('remounts children on a real scope change when active', () => {
    render(
      <OrganizationScopeBoundary active>
        <MountCounter />
      </OrganizationScopeBoundary>,
    )
    expect(mountCount).toBe(1)

    // First scope event after mount only establishes the baseline.
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-a', tenantId: 'tenant-a' })
    })
    expect(mountCount).toBe(1)

    // A genuine change remounts the subtree, re-running mount effects.
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-b', tenantId: 'tenant-a' })
    })
    expect(mountCount).toBe(2)
  })

  it('does not remount children when the scope is unchanged', () => {
    render(
      <OrganizationScopeBoundary active>
        <MountCounter />
      </OrganizationScopeBoundary>,
    )
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-c', tenantId: 'tenant-c' })
    })
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-c', tenantId: 'tenant-c' })
    })
    expect(mountCount).toBe(1)
  })

  it('does not remount children on a scope change when inactive', () => {
    render(
      <OrganizationScopeBoundary active={false}>
        <MountCounter />
      </OrganizationScopeBoundary>,
    )
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-d', tenantId: 'tenant-d' })
    })
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-e', tenantId: 'tenant-e' })
    })
    expect(mountCount).toBe(1)
  })
})
