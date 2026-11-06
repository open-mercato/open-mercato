/** @jest-environment jsdom */

import type { Page } from '@playwright/test'
import { loginStaffInBrowser } from '../fixtures'

jest.mock('@playwright/test', () => ({ expect: (actual: unknown) => jest.requireActual('expect').expect(actual) }))

type ScopeEvents = typeof import('@open-mercato/shared/lib/frontend/organizationEvents')

function browserLogin(status = 200) {
  const token = `header.${Buffer.from(JSON.stringify({ tenantId: 'actor-tenant', orgId: 'actor-org' })).toString('base64url')}.signature`
  const selectedAtNavigation: Record<string, string>[] = []
  let scopeEvents: ScopeEvents | undefined
  const page = {
    request: {
      post: jest.fn(async () => ({ ok: () => status === 200, status: () => status, text: async () => JSON.stringify({ token }) })),
    },
    context: () => ({
      addCookies: jest.fn(async (cookies: Array<{ name: string; value: string }>) => {
        for (const cookie of cookies) document.cookie = `${cookie.name}=${cookie.value}; path=/`
      }),
    }),
    goto: jest.fn(async () => {
      selectedAtNavigation.push(Object.fromEntries(document.cookie.split('; ').map((cookie) => cookie.split('='))))
      jest.isolateModules(() => {
        scopeEvents = require('@open-mercato/shared/lib/frontend/organizationEvents') as ScopeEvents
      })
    }),
    waitForURL: jest.fn(),
  }
  return { page: page as unknown as Page, selectedAtNavigation, scopeEvents: () => scopeEvents! }
}

describe('Staff browser login scope', () => {
  beforeEach(() => {
    for (const cookie of document.cookie.split('; ')) document.cookie = `${cookie.split('=')[0]}=; Max-Age=0; path=/`
  })

  it('installs the authenticated actor scope before the first backend navigation', async () => {
    document.cookie = 'om_selected_tenant=previous-tenant; path=/'
    document.cookie = 'om_selected_org=previous-org; path=/'
    const browser = browserLogin()

    await loginStaffInBrowser(browser.page, { email: 'actor@example.test', password: 'fixture-password' })

    expect(browser.selectedAtNavigation).toEqual([expect.objectContaining({
      om_selected_tenant: 'actor-tenant',
      om_selected_org: 'actor-org',
    })])
  })

  it('keeps drawer query versions stable when the delayed organization switcher hydrates', async () => {
    const browser = browserLogin()
    await loginStaffInBrowser(browser.page, { email: 'actor@example.test', password: 'fixture-password' })
    const events = browser.scopeEvents()
    const drawerVersion = events.getCurrentOrganizationScopeVersion()

    events.emitOrganizationScopeChanged({ tenantId: 'actor-tenant', organizationId: 'actor-org' })

    expect(events.getCurrentOrganizationScopeVersion()).toBe(drawerVersion)
    events.emitOrganizationScopeChanged({ tenantId: 'actor-tenant', organizationId: 'different-org' })
    expect(events.getCurrentOrganizationScopeVersion()).toBe(drawerVersion + 1)
  })

  it('does not navigate after a rejected login', async () => {
    const browser = browserLogin(401)

    await expect(loginStaffInBrowser(browser.page, { email: 'actor@example.test', password: 'fixture-password' })).rejects.toThrow()

    expect(browser.selectedAtNavigation).toEqual([])
  })
})
