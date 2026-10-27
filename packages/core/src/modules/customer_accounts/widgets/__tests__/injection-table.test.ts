/**
 * @jest-environment node
 */

import type { ModuleInjectionSlot, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

import { injectionTable } from '../injection-table'

const CRUD_FORM_PREFIX = 'crud-form:'

// The suffix grammar CrudFormInjectionSpots can append after the entity id. CrudForm normalizes
// every ':' in the entity id to '.', so the entity id is always the first ':'-delimited token and
// anything after it must match one of these shapes.
const CRUD_FORM_SUFFIX_PATTERNS = [
  /^$/,
  /^(fields|header|footer|sidebar|before-fields|after-fields)$/,
  /^group:[^:]+$/,
  /^field:[^:]+:(before|after)$/,
]

function isReachableCrudFormSpot(spotId: string): boolean {
  const rest = spotId.slice(CRUD_FORM_PREFIX.length)
  const separatorIndex = rest.indexOf(':')
  const suffix = separatorIndex === -1 ? '' : rest.slice(separatorIndex + 1)
  return CRUD_FORM_SUFFIX_PATTERNS.some((pattern) => pattern.test(suffix))
}

function expectSingleGroupWidget(
  table: ModuleInjectionTable,
  spotId: string,
  widgetId: string,
  groupLabel: string,
  column: 1 | 2,
) {
  const slots = table[spotId]
  expect(Array.isArray(slots)).toBe(true)
  const [slot] = slots as ModuleInjectionSlot[]
  expect(slot).toEqual({
    widgetId,
    kind: 'group',
    column,
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
        2,
      )
    }
  })

  // Regression guard for #4400: a column-2 group forces CrudForm into the narrow
  // 7fr/3fr secondary-column layout on company details. Portal users must stay a
  // full-width row in the column-1 stack.
  it('registers the company-users widget in column 1 on the spots the company detail host requests', () => {
    for (const spotId of ['customers.company', 'crud-form:customers.company']) {
      expectSingleGroupWidget(
        injectionTable,
        spotId,
        'customer_accounts.injection.company-users',
        'customer_accounts.widgets.portalUsers',
        1,
      )
    }
  })

  // Regression guard for #3952: CrudForm builds its spot id as `crud-form:${entityId}` with every
  // ':' normalized to '.', so a key carrying an un-normalized (colon-form) entity id is unreachable
  // by construction — no host can ever request it. Two such keys shipped as dead "backward
  // compatible" registrations.
  it('registers crud-form spots only in the normalized form CrudForm can emit', () => {
    const unreachable = Object.keys(injectionTable)
      .filter((spotId) => spotId.startsWith(CRUD_FORM_PREFIX))
      .filter((spotId) => !isReachableCrudFormSpot(spotId))

    expect(unreachable).toEqual([])
  })

  it('accepts the structured crud-form suffixes CrudFormInjectionSpots can emit', () => {
    for (const spotId of [
      'crud-form:customers.person',
      'crud-form:customers.person:fields',
      'crud-form:customers.person:group:details',
      'crud-form:customers.person:field:email:before',
    ]) {
      expect(isReachableCrudFormSpot(spotId)).toBe(true)
    }

    expect(isReachableCrudFormSpot('crud-form:customers:customer_person_profile:fields')).toBe(false)
  })
})
