/**
 * @jest-environment node
 */

import type { ModuleInjectionSlot, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

import { injectionTable } from '../injection-table'

const CRUD_FORM_PREFIX = 'crud-form:'

// Suffixes CrudForm appends after the normalized entity id (see CrudFormInjectionSpots).
const CRUD_FORM_SUFFIXES = [
  'fields',
  'header',
  'footer',
  'sidebar',
  'before-fields',
  'after-fields',
]

function entitySegmentOf(spotId: string): string {
  const rest = spotId.slice(CRUD_FORM_PREFIX.length)
  const suffix = CRUD_FORM_SUFFIXES.find((candidate) => rest.endsWith(`:${candidate}`))
  return suffix ? rest.slice(0, -(suffix.length + 1)) : rest
}

function expectSingleGroupWidget(
  table: ModuleInjectionTable,
  spotId: string,
  widgetId: string,
  groupLabel: string,
) {
  const slots = table[spotId]
  expect(Array.isArray(slots)).toBe(true)
  const [slot] = slots as ModuleInjectionSlot[]
  expect(slot).toEqual({
    widgetId,
    kind: 'group',
    column: 2,
    groupLabel,
    priority: 200,
  })
}

describe('customer_accounts injection table', () => {
  it('registers the account-status widget on the spots the person detail host requests', () => {
    for (const spotId of ['customers.person', 'crud-form:customers.person']) {
      expectSingleGroupWidget(
        injectionTable,
        spotId,
        'customer_accounts.injection.account-status',
        'customer_accounts.widgets.accountStatus',
      )
    }
  })

  it('registers the company-users widget on the spots the company detail host requests', () => {
    for (const spotId of ['customers.company', 'crud-form:customers.company']) {
      expectSingleGroupWidget(
        injectionTable,
        spotId,
        'customer_accounts.injection.company-users',
        'customer_accounts.widgets.portalUsers',
      )
    }
  })

  // Regression guard for #3952: CrudForm builds its spot id as `crud-form:${entityId}` with
  // every ':' normalized to '.', so a registered key whose entity segment still contains ':'
  // is unreachable by construction — no host can ever request it. Two such keys shipped as
  // dead "backward compatible" registrations.
  it('registers crud-form spots only in the normalized form CrudForm can emit', () => {
    const unreachable = Object.keys(injectionTable)
      .filter((spotId) => spotId.startsWith(CRUD_FORM_PREFIX))
      .filter((spotId) => entitySegmentOf(spotId).includes(':'))

    expect(unreachable).toEqual([])
  })
})
