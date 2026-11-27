import { buildJsonExportDisposition } from '../export-filename'

describe('buildJsonExportDisposition', () => {
  it('preserves the existing ASCII filename', () => {
    expect(buildJsonExportDisposition('forms-submission-123.json')).toBe(
      'attachment; filename="forms-submission-123.json"; filename*=UTF-8\'\'forms-submission-123.json',
    )
  })

  it.each([
    ['forms-export-customer name-123.json', 'forms-export-customer_name-123.json', 'forms-export-customer%20name-123.json'],
    ['forms-export-a";b-123.json', 'forms-export-a__b-123.json', 'forms-export-a%22%3Bb-123.json'],
    ['forms-export-café-123.json', 'forms-export-cafe-123.json', 'forms-export-caf%C3%A9-123.json'],
    ['forms-export-客户-123.json', 'forms-export-__-123.json', 'forms-export-%E5%AE%A2%E6%88%B7-123.json'],
  ])('formats %s safely', (name, fallback, encoded) => {
    expect(buildJsonExportDisposition(name)).toBe(
      `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    )
  })
})
