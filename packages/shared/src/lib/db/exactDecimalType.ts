import { DecimalType, type EntityProperty, type Platform } from '@mikro-orm/core'
import { parseDecimal } from '../decimal'

/**
 * Unconstrained `numeric` mapped to a decimal string. MikroORM's `DecimalType`
 * detects changes by comparing `+value`, so an edit beyond float precision
 * (`1.123456789012345678` -> `...679`) is never flushed. This type compares the
 * exact decimal values instead.
 */
export class ExactDecimalType extends DecimalType {
  constructor() {
    super('string')
  }

  getColumnType(_property: EntityProperty, _platform: Platform): string {
    return 'numeric'
  }

  compareValues(left: unknown, right: unknown): boolean {
    const leftDecimal = parseDecimal(left)
    const rightDecimal = parseDecimal(right)
    if (!leftDecimal || !rightDecimal) return left === right
    return leftDecimal.eq(rightDecimal)
  }
}
