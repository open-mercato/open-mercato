import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * How one organization renders dates, times, money, addresses, phones, units and documents.
 *
 * One row per organization, tenant scoped. Absence of a row means "no market picked yet" and
 * resolves to the frozen legacy defaults, so an upgrade changes nothing for an existing tenant
 * (spec assumption A5). The unique constraint on (organization_id, tenant_id) is also the only
 * access path - a point lookup - so no further index is needed.
 */
@Entity({ tableName: 'market_display_profiles' })
@Unique({
  name: 'market_display_profiles_scope_unique',
  properties: ['organizationId', 'tenantId'],
})
export class MarketDisplayProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  // Language and currency
  @Property({ name: 'language_tag', type: 'text' })
  languageTag!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'currency_display', type: 'text', default: 'symbol' })
  currencyDisplay: string = 'symbol'

  @Property({ name: 'decimal_separator', type: 'text', nullable: true })
  decimalSeparator?: string | null

  @Property({ name: 'thousands_separator', type: 'text', nullable: true })
  thousandsSeparator?: string | null

  @Property({ name: 'negative_style', type: 'text', default: 'minus' })
  negativeStyle: string = 'minus'

  // Dates and times
  @Property({ name: 'date_format', type: 'text' })
  dateFormat!: string

  @Property({ name: 'date_time_format', type: 'text' })
  dateTimeFormat!: string

  @Property({ name: 'time_format', type: 'text' })
  timeFormat!: string

  @Property({ name: 'hour_cycle', type: 'text', default: 'h23' })
  hourCycle: string = 'h23'

  @Property({ name: 'first_day_of_week', type: 'integer', default: 1 })
  firstDayOfWeek: number = 1

  @Property({ name: 'time_zone', type: 'text' })
  timeZone!: string

  // Addresses
  @Property({ name: 'address_layout', type: 'text', default: 'line_first' })
  addressLayout: string = 'line_first'

  @Property({ name: 'default_country_code', type: 'text' })
  defaultCountryCode!: string

  @Property({ name: 'subdivision_required', type: 'boolean', default: false })
  subdivisionRequired: boolean = false

  @Property({ name: 'postal_code_pattern', type: 'text', nullable: true })
  postalCodePattern?: string | null

  @Property({ name: 'postal_code_label_key', type: 'text' })
  postalCodeLabelKey!: string

  @Property({ name: 'subdivision_label_key', type: 'text' })
  subdivisionLabelKey!: string

  @Property({ name: 'address_line2_label_key', type: 'text' })
  addressLine2LabelKey!: string

  @Property({ name: 'phone_national_pattern', type: 'text', nullable: true })
  phoneNationalPattern?: string | null

  @Property({ name: 'phone_default_dial_code', type: 'text', nullable: true })
  phoneDefaultDialCode?: string | null

  // Units
  @Property({ name: 'measurement_system', type: 'text', default: 'metric' })
  measurementSystem: string = 'metric'

  @Property({ name: 'default_weight_unit', type: 'text', default: 'kg' })
  defaultWeightUnit: string = 'kg'

  @Property({ name: 'default_length_unit', type: 'text', default: 'cm' })
  defaultLengthUnit: string = 'cm'

  @Property({ name: 'length_display', type: 'text', default: 'decimal' })
  lengthDisplay: string = 'decimal'

  // Documents
  @Property({ name: 'paper_size', type: 'text', default: 'a4' })
  paperSize: string = 'a4'

  // Prices and tax
  @Property({ name: 'price_presentation', type: 'text', default: 'dual_net_gross' })
  pricePresentation: string = 'dual_net_gross'

  @Property({ name: 'tax_line_label_key', type: 'text' })
  taxLineLabelKey!: string

  @Property({ name: 'tax_note_key', type: 'text', nullable: true })
  taxNoteKey?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
