/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { dealDescriptor } from '../../../components/__tests__/fixtures'
import {
  findExplainFieldLabelKey,
  findFormExplainResource,
  hasExplainableFormFields,
  readFormEntityIdFromSpotId,
  resolveExplainFieldKey,
} from '../fieldExplain'
import { readExplainMode, resetExplainModeState, setExplainMode, useExplainMode } from '../explainMode'

const STORAGE_KEY = 'om:insights:explain-mode:customers.deal'

describe('field explain mapping', () => {
  it('reads the entity segment of a CrudForm spot id only', () => {
    expect(readFormEntityIdFromSpotId('crud-form:customers.deal')).toBe('customers.deal')
    expect(readFormEntityIdFromSpotId('crud-form:')).toBeNull()
    expect(readFormEntityIdFromSpotId('example:async-widget')).toBeNull()
    expect(readFormEntityIdFromSpotId(null)).toBeNull()
  })

  it('finds the resource by declared form entity id before the resource kind', () => {
    const deal = dealDescriptor({ formEntityIds: ['customers.deal', 'customers.customer_deal'] })
    const person = dealDescriptor({ resourceKind: 'customers.person', formEntityIds: ['customers.person'] })
    expect(findFormExplainResource([person, deal], 'customers.customer_deal')).toBe(deal)
    expect(findFormExplainResource([person, deal], 'customers.person', 'customers.deal')).toBe(person)
    expect(findFormExplainResource([person, deal], 'catalog.product', 'customers.deal')).toBe(deal)
    expect(findFormExplainResource([person, deal], 'catalog.product')).toBeNull()
    expect(findFormExplainResource([], 'customers.deal')).toBeNull()
  })

  it('maps field ids by key, then by current path', () => {
    const resource = dealDescriptor({
      fields: [
        { key: 'status', labelKey: 'customers.insights.fields.status', valueKind: 'dictionary', currentPath: 'status', derived: false, dependsOn: [], provider: null },
        { key: 'total', labelKey: 'sales.insights.fields.total', valueKind: 'money', currentPath: 'grandTotalGrossAmount', derived: true, dependsOn: [], provider: null },
      ],
    })
    expect(resolveExplainFieldKey(resource, 'status')).toBe('status')
    expect(resolveExplainFieldKey(resource, 'grandTotalGrossAmount')).toBe('total')
    expect(resolveExplainFieldKey(resource, 'description')).toBeNull()
    expect(resolveExplainFieldKey(resource, '')).toBeNull()
    expect(findExplainFieldLabelKey(resource, 'total')).toBe('sales.insights.fields.total')
    expect(findExplainFieldLabelKey(resource, 'cf:priority')).toBeNull()
  })

  it('maps custom fields to cf:<key> only when the viewer may read them', () => {
    const withCustomFields = dealDescriptor({ customFields: { entityId: 'customers:customer_deal', allowKeys: null } })
    expect(resolveExplainFieldKey(withCustomFields, 'cf_priority')).toBe('cf:priority')
    expect(resolveExplainFieldKey(withCustomFields, 'cf:priority')).toBe('cf:priority')
    expect(resolveExplainFieldKey(withCustomFields, 'cf_')).toBeNull()

    const allowList = dealDescriptor({ customFields: { entityId: 'customers:customer_deal', allowKeys: ['priority'] } })
    expect(resolveExplainFieldKey(allowList, 'cf_priority')).toBe('cf:priority')
    expect(resolveExplainFieldKey(allowList, 'cf_secret')).toBeNull()

    expect(resolveExplainFieldKey(dealDescriptor(), 'cf_priority')).toBeNull()
  })

  it('treats a resource without fields or custom fields as not explainable on a form', () => {
    expect(hasExplainableFormFields(dealDescriptor())).toBe(true)
    expect(hasExplainableFormFields(dealDescriptor({ fields: [] }))).toBe(false)
    expect(hasExplainableFormFields(dealDescriptor({ fields: [], customFields: { entityId: 'x:y', allowKeys: null } }))).toBe(true)
  })
})

describe('explain mode', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetExplainModeState()
  })

  it('is off by default and remembered per form in local storage', () => {
    expect(readExplainMode('customers.deal')).toBe(false)
    setExplainMode('customers.deal', true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(readExplainMode('customers.person')).toBe(false)

    resetExplainModeState()
    expect(readExplainMode('customers.deal')).toBe(true)

    setExplainMode('customers.deal', false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('shares the state between every subscriber of the same form', () => {
    const first = renderHook(() => useExplainMode('customers.deal'))
    const second = renderHook(() => useExplainMode('customers.deal'))
    const other = renderHook(() => useExplainMode('customers.person'))
    expect(first.result.current[0]).toBe(false)

    act(() => first.result.current[1](true))
    expect(second.result.current[0]).toBe(true)
    expect(other.result.current[0]).toBe(false)

    act(() => second.result.current[1](false))
    expect(first.result.current[0]).toBe(false)
  })

  it('stays off without a form', () => {
    const { result } = renderHook(() => useExplainMode(null))
    act(() => result.current[1](true))
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.length).toBe(0)
  })
})
