/**
 * @jest-environment node
 */

import type { ModuleInjectionSlot, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

import { injectionTable } from '../injection-table'

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
  it('registers the account-status widget on current v2 and legacy customer person form spots', () => {
    for (const spotId of [
      'customers.person',
      'crud-form:customers.person',
      'crud-form:customers:customer_person_profile:fields',
    ]) {
      expectSingleGroupWidget(
        injectionTable,
        spotId,
        'customer_accounts.injection.account-status',
        'customer_accounts.widgets.accountStatus',
      )
    }
  })

  it('registers the company-users widget on current v2 and legacy customer company form spots', () => {
    for (const spotId of [
      'customers.company',
      'crud-form:customers.company',
      'crud-form:customers:customer_company_profile:fields',
    ]) {
      expectSingleGroupWidget(
        injectionTable,
        spotId,
        'customer_accounts.injection.company-users',
        'customer_accounts.widgets.portalUsers',
      )
    }
  })
})
