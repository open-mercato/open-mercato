import test from 'node:test'
import assert from 'node:assert/strict'

import {
  compareLocale,
  flattenDictionary,
  isLegitimatelyIdenticalValue,
} from '../i18n-values-scanner.mjs'

test('flattenDictionary handles flat and nested dictionaries', () => {
  const nested = {
    customers: {
      title: 'Customers',
      list: { empty: 'No customers yet' },
    },
    'auth.login.title': 'Sign in',
  }
  const flat = flattenDictionary(nested)
  assert.equal(flat['customers.title'], 'Customers')
  assert.equal(flat['customers.list.empty'], 'No customers yet')
  assert.equal(flat['auth.login.title'], 'Sign in')
})

test('isLegitimatelyIdenticalValue treats acronyms, numbers, URLs, and short tokens as legitimate', () => {
  assert.equal(isLegitimatelyIdenticalValue('OK'), true)
  assert.equal(isLegitimatelyIdenticalValue('API'), true)
  assert.equal(isLegitimatelyIdenticalValue('JSON'), true)
  assert.equal(isLegitimatelyIdenticalValue('123'), true)
  assert.equal(isLegitimatelyIdenticalValue('42.5%'), true)
  assert.equal(isLegitimatelyIdenticalValue('https://example.com'), true)
  assert.equal(isLegitimatelyIdenticalValue('{{count}}'), true)
  assert.equal(isLegitimatelyIdenticalValue('Tag'), true, 'tokens up to 4 chars stay legitimate')

  assert.equal(isLegitimatelyIdenticalValue('Customer'), false)
  assert.equal(isLegitimatelyIdenticalValue('Save changes'), false)
})

test('compareLocale counts identical/translated/missing entries and isolates significant ones', () => {
  const en = {
    'auth.login.title': 'Sign in',
    'auth.login.submit': 'Continue',
    'shared.actions.ok': 'OK',
    'shared.brand.name': 'Open Mercato',
    'shared.metric.percentage': '50%',
    'customers.list.empty': 'No customers yet',
    'customers.list.title': 'Customers',
  }
  const pl = {
    'auth.login.title': 'Zaloguj się',
    'auth.login.submit': 'Kontynuuj',
    'shared.actions.ok': 'OK',
    'shared.brand.name': 'Open Mercato',
    'shared.metric.percentage': '50%',
    'customers.list.empty': 'No customers yet',
    'customers.list.title': 'Klienci',
  }

  const result = compareLocale(en, pl, { allowlist: new Set(['shared.brand.name']) })
  assert.equal(result.total, 7)
  assert.equal(result.translated, 3)
  assert.equal(result.missing, 0)
  assert.equal(result.identical, 4, 'OK, brand, 50%, customers.list.empty all equal English')
  assert.equal(result.identicalSignificant, 1, 'only customers.list.empty is a significant miss')
  assert.equal(result.samples[0].key, 'customers.list.empty')
})

test('compareLocale counts missing keys and does not double-count them as identical', () => {
  const en = {
    'a.b': 'Hello world',
    'a.c': 'Goodbye now',
  }
  const pl = {
    'a.b': 'Witaj świecie',
  }
  const result = compareLocale(en, pl)
  assert.equal(result.total, 2)
  assert.equal(result.translated, 1)
  assert.equal(result.missing, 1)
  assert.equal(result.identical, 0)
  assert.equal(result.identicalSignificant, 0)
})
