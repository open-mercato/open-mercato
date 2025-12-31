import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'currencies' })
@Index({
  name: 'currencies_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'currencies_code_scope_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class Currency {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Currency identification (ISO 4217)
  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  symbol?: string | null

  // Formatting
  @Property({ name: 'decimal_places', type: 'integer', default: 2 })
  decimalPlaces: number = 2

  @Property({ name: 'thousands_separator', type: 'text', nullable: true })
  thousandsSeparator?: string | null

  @Property({ name: 'decimal_separator', type: 'text', nullable: true })
  decimalSeparator?: string | null

  // Base currency flag
  @Property({ name: 'is_base', type: 'boolean', default: false })
  isBase: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  // Audit fields
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'exchange_rates' })
@Index({
  name: 'exchange_rates_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'exchange_rates_pair_idx',
  properties: ['fromCurrencyCode', 'toCurrencyCode', 'date'],
})
@Unique({
  name: 'exchange_rates_pair_datetime_source_unique',
  properties: ['organizationId', 'tenantId', 'fromCurrencyCode', 'toCurrencyCode', 'date', 'source'],
})
export class ExchangeRate {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Currency pair (using codes, not FKs - matches existing pattern)
  @Property({ name: 'from_currency_code', type: 'text' })
  fromCurrencyCode!: string

  @Property({ name: 'to_currency_code', type: 'text' })
  toCurrencyCode!: string

  // Rate value (high precision for crypto/forex)
  @Property({ type: 'numeric', precision: 18, scale: 8 })
  rate!: string

  // Date and time when the rate applies (stored as timestamptz)
  @Property({ name: 'date', type: 'timestamptz' })
  date!: Date

  // Source tracking (required)
  @Property({ type: 'text' })
  source!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  // Audit fields
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
