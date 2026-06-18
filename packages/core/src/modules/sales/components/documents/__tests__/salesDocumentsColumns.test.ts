import {
  SALES_DOCUMENT_NUMBER_COLUMN_MAX_WIDTH,
  SALES_DOCUMENT_NUMBER_COLUMN_META,
} from '../salesDocumentsColumns'
import {
  DEFAULT_ORDER_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
} from '../../../lib/documentNumberTokens'

const DATA_TABLE_DEFAULT_MAX_WIDTH_PX = 150

const parsePx = (value: string): number => Number.parseInt(value.replace('px', ''), 10)

const renderSampleNumber = (format: string): string =>
  format
    .replace('{yyyy}', '2026')
    .replace('{mm}', '06')
    .replace('{dd}', '10')
    .replace('{seq:5}', '00123')

describe('sales documents number column width (issue #2947)', () => {
  it('keeps the column sticky', () => {
    expect(SALES_DOCUMENT_NUMBER_COLUMN_META.sticky).toBe(true)
  })

  it('declares an explicit maxWidth so it does not fall back to the DataTable default', () => {
    expect(SALES_DOCUMENT_NUMBER_COLUMN_META.maxWidth).toBe(SALES_DOCUMENT_NUMBER_COLUMN_MAX_WIDTH)
    expect(parsePx(SALES_DOCUMENT_NUMBER_COLUMN_MAX_WIDTH)).toBeGreaterThan(DATA_TABLE_DEFAULT_MAX_WIDTH_PX)
  })

  it.each([
    ['order', DEFAULT_ORDER_NUMBER_FORMAT],
    ['quote', DEFAULT_QUOTE_NUMBER_FORMAT],
  ])('reserves enough width for the default %s number format', (_kind, format) => {
    const sampleNumber = renderSampleNumber(format)
    expect(parsePx(SALES_DOCUMENT_NUMBER_COLUMN_MAX_WIDTH)).toBeGreaterThanOrEqual(sampleNumber.length * 9)
  })
})
