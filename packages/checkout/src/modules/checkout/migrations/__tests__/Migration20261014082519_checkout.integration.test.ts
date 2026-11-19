import { describeNumericWideningMigrations } from '@open-mercato/core/__tests__/__fixtures__/numericWideningMigrationHarness'
import { Migration20261014082519_checkout } from '../Migration20261014082519_checkout'

describeNumericWideningMigrations('Checkout money columns widened to unconstrained numeric', [
  { migration: Migration20261014082519_checkout, legacy: { precision: 12, scale: 2 } },
])
