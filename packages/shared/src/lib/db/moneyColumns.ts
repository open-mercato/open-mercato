import { Embeddable, Property } from '@mikro-orm/decorators/legacy'
import { restoreMoney, snapshotMoney } from '../money/serialization'
import type { Money } from '../money/types'
import { ExactDecimalType } from './exactDecimalType'

/**
 * Persisted `MoneySnapshot`: an exact amount plus the currency code and the
 * currency decimal places at write time. Embed it in a NEW entity with
 * `@Embedded(() => MoneyColumns, { prefix: 'price_' })` to get `price_amount`,
 * `price_currency_code` and `price_currency_decimal_places`. Entities hold
 * `MoneyColumns`, never `Money`: convert at the command or service boundary.
 */
@Embeddable()
export class MoneyColumns {
  @Property({ type: ExactDecimalType, columnType: 'numeric' })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'currency_decimal_places', type: 'integer' })
  currencyDecimalPlaces!: number
}

export function moneyToColumns(money: Money): MoneyColumns {
  return Object.assign(new MoneyColumns(), snapshotMoney(money))
}

/**
 * Restores stored money at the precision it was written with (throws on a
 * partially null or invalid row). For a nullable embedded field call
 * `columns ? moneyFromColumns(columns) : null`.
 */
export function moneyFromColumns(columns: MoneyColumns): Money {
  return restoreMoney({
    amount: columns.amount,
    currencyCode: columns.currencyCode,
    currencyDecimalPlaces: columns.currencyDecimalPlaces,
  })
}
