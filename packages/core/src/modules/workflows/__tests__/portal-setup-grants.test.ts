/**
 * The portal grants the workflows module ships.
 *
 * `defaultCustomerRoleFeatures` is a seam no shipped module used before this
 * change, and its merge skips a slug it cannot find (`if (!role) continue`) — so
 * a typo in a role slug is a silent no-op that nobody notices until a customer
 * cannot open their task list. These assertions are what make that loud.
 */

import { describe, test, expect } from '@jest/globals'
import { setup as workflowsSetup } from '../setup'
import { DEFAULT_CUSTOMER_ROLE_SLUGS } from '@open-mercato/core/modules/customer_accounts/setup'
import {
  PORTAL_TASKS_COMPLETE_FEATURE,
  PORTAL_TASKS_VIEW_FEATURE,
} from '../lib/portal-task-access'

describe('workflows portal role grants', () => {
  const grants = workflowsSetup.defaultCustomerRoleFeatures ?? {}

  test('every targeted role slug is one customer_accounts actually seeds', () => {
    for (const slug of Object.keys(grants)) {
      expect(DEFAULT_CUSTOMER_ROLE_SLUGS).toContain(slug)
    }
  })

  test('a buyer can see AND finish their work; a viewer only sees it', () => {
    expect(grants.buyer).toEqual([PORTAL_TASKS_VIEW_FEATURE, PORTAL_TASKS_COMPLETE_FEATURE])
    expect(grants.viewer).toEqual([PORTAL_TASKS_VIEW_FEATURE])
  })

  test('portal_admin is deliberately NOT granted these explicitly', () => {
    // It carries `portal.*`, and a wildcard is exactly what the portal branch of
    // the visibility predicate refuses to treat as ownership. Naming it here
    // would suggest the wildcard buys something on this surface. It does not.
    expect(grants).not.toHaveProperty('portal_admin')
  })

  test('the grants are portal-namespaced and never leak a backoffice feature', () => {
    for (const features of Object.values(grants)) {
      for (const feature of features ?? []) {
        expect(feature.startsWith('portal.')).toBe(true)
      }
    }
  })

  test('the backoffice grants are untouched by the portal addition', () => {
    expect(workflowsSetup.defaultRoleFeatures?.admin).toEqual(['workflows.*'])
  })
})
