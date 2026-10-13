import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export const CATALOG_UNIT_DEFAULTS = [
  { value: 'pc', label: 'Piece (piece)', labelKey: 'catalog.units.pc' },
  { value: 'set', label: 'Set (piece)', labelKey: 'catalog.units.set' },
  { value: 'pkg', label: 'Package (piece)', labelKey: 'catalog.units.pkg' },
  { value: 'box', label: 'Box (piece)', labelKey: 'catalog.units.box' },
  { value: 'roll', label: 'Roll (piece)', labelKey: 'catalog.units.roll' },
  { value: 'pair', label: 'Pair (piece)', labelKey: 'catalog.units.pair' },
  { value: 'dozen', label: 'Dozen (piece)', labelKey: 'catalog.units.dozen' },
  { value: 'unit', label: 'Unit (piece)', labelKey: 'catalog.units.unit' },
  { value: 'g', label: 'Gram (weight)', labelKey: 'catalog.units.g' },
  { value: 'kg', label: 'Kilogram (weight)', labelKey: 'catalog.units.kg' },
  { value: 'mg', label: 'Milligram (weight)', labelKey: 'catalog.units.mg' },
  { value: 'lb', label: 'Pound (weight)', labelKey: 'catalog.units.lb' },
  { value: 'oz', label: 'Ounce (weight)', labelKey: 'catalog.units.oz' },
  { value: 'ml', label: 'Milliliter (volume)', labelKey: 'catalog.units.ml' },
  { value: 'l', label: 'Liter (volume)', labelKey: 'catalog.units.l' },
  { value: 'cl', label: 'Centiliter (volume)', labelKey: 'catalog.units.cl' },
  { value: 'm3', label: 'Cubic Meter (volume)', labelKey: 'catalog.units.m3' },
  { value: 'mm', label: 'Millimeter (length)', labelKey: 'catalog.units.mm' },
  { value: 'cm', label: 'Centimeter (length)', labelKey: 'catalog.units.cm' },
  { value: 'm', label: 'Meter (length)', labelKey: 'catalog.units.m' },
  { value: 'km', label: 'Kilometer (length)', labelKey: 'catalog.units.km' },
  { value: 'in', label: 'Inch (length)', labelKey: 'catalog.units.in' },
  { value: 'ft', label: 'Foot (length)', labelKey: 'catalog.units.ft' },
  { value: 'm2', label: 'Square Meter (area)', labelKey: 'catalog.units.m2' },
  { value: 'cm2', label: 'Square Centimeter (area)', labelKey: 'catalog.units.cm2' },
  { value: 'ft2', label: 'Square Foot (area)', labelKey: 'catalog.units.ft2' },
  { value: 'gb', label: 'Gigabyte (digital)', labelKey: 'catalog.units.gb' },
  { value: 'mb', label: 'Megabyte (digital)', labelKey: 'catalog.units.mb' },
  { value: 'tb', label: 'Terabyte (digital)', labelKey: 'catalog.units.tb' },
  { value: 'license', label: 'License (digital)', labelKey: 'catalog.units.license' },
  { value: 'seat', label: 'Seat (digital)', labelKey: 'catalog.units.seat' },
  { value: 'sec', label: 'Second (time)', labelKey: 'catalog.units.sec' },
  { value: 'min', label: 'Minute (time)', labelKey: 'catalog.units.min' },
  { value: 'hour', label: 'Hour (time)', labelKey: 'catalog.units.hour' },
  { value: 'day', label: 'Day (time)', labelKey: 'catalog.units.day' },
  { value: 'week', label: 'Week (time)', labelKey: 'catalog.units.week' },
  { value: 'month', label: 'Month (time)', labelKey: 'catalog.units.month' },
  { value: 'year', label: 'Year (time)', labelKey: 'catalog.units.year' },
  { value: 'kwh', label: 'Kilowatt Hour (energy)', labelKey: 'catalog.units.kwh' },
] as const

const defaultsByCode = new Map<string, (typeof CATALOG_UNIT_DEFAULTS)[number]>(
  CATALOG_UNIT_DEFAULTS.map((unit) => [unit.value, unit]),
)

export function translateCatalogUnitLabel(value: string, label: string, t: TranslateFn): string {
  const unit = defaultsByCode.get(value.toLowerCase())
  return unit && label === unit.label ? t(unit.labelKey, label) : label
}
