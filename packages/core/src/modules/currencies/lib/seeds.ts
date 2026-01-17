import type { EntityManager } from '@mikro-orm/postgresql'
import { Currency } from '../data/entities'

export type CurrencySeedScope = { tenantId: string; organizationId: string }

type CurrencySeed = {
  code: string
  name: string
  decimalPlaces: number
  symbol: string
  decimalSeparator: string
  thousandsSeparator: string
  isBase: boolean
  isActive: boolean
}

const SEED_CURRENCIES: CurrencySeed[] = [
  {
    code: 'USD',
    name: 'US Dollar',
    decimalPlaces: 2,
    symbol: '$',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: true,
    isActive: true,
  },
  {
    code: 'EUR',
    name: 'Euro',
    decimalPlaces: 2,
    symbol: '€',
    decimalSeparator: ',',
    thousandsSeparator: '.',
    isBase: false,
    isActive: true,
  },
  {
    code: 'JPY',
    name: 'Japanese Yen',
    decimalPlaces: 0,
    symbol: '¥',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: false,
    isActive: true,
  },
  {
    code: 'GBP',
    name: 'British Pound',
    decimalPlaces: 2,
    symbol: '£',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: false,
    isActive: true,
  },
  {
    code: 'CHF',
    name: 'Swiss Franc',
    decimalPlaces: 2,
    symbol: 'Fr',
    decimalSeparator: '.',
    thousandsSeparator: "'",
    isBase: false,
    isActive: true,
  },
  {
    code: 'CAD',
    name: 'Canadian Dollar',
    decimalPlaces: 2,
    symbol: 'C$',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: false,
    isActive: true,
  },
  {
    code: 'AUD',
    name: 'Australian Dollar',
    decimalPlaces: 2,
    symbol: 'A$',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: false,
    isActive: true,
  },
  {
    code: 'CNY',
    name: 'Chinese Yuan',
    decimalPlaces: 2,
    symbol: '¥',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: false,
    isActive: true,
  },
  {
    code: 'CNH',
    name: 'Chinese Yuan (Offshore)',
    decimalPlaces: 2,
    symbol: '¥',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    isBase: false,
    isActive: true,
  },
  {
    code: 'PLN',
    name: 'Polish Zloty',
    decimalPlaces: 2,
    symbol: 'zł',
    decimalSeparator: ',',
    thousandsSeparator: ' ',
    isBase: false,
    isActive: true,
  },
]

export async function seedExampleCurrencies(em: EntityManager, scope: CurrencySeedScope): Promise<boolean> {
  const existingEntries = await em.find(Currency, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingMap = new Map<string, Currency>()
  for (const entry of existingEntries) {
    existingMap.set(entry.code, entry)
  }

  let touched = false
  for (const curr of SEED_CURRENCIES) {
    const current = existingMap.get(curr.code)
    if (current) {
      if (current.name !== curr.name) {
        current.name = curr.name
        current.updatedAt = new Date()
        em.persist(current)
        touched = true
      }
      continue
    }
    const entry = em.create(Currency, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...curr,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
    touched = true
  }

  if (touched) {
    await em.flush()
  }
  return touched
}
