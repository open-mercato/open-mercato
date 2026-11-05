import { formatChangelogValue } from '../changelogValues'

describe('formatChangelogValue', () => {
  it('uses customer link display names instead of raw ids', () => {
    expect(formatChangelogValue([
      {
        linkId: 'fa8a774a-b8eb-4a29-b826-405a31969366',
        companyId: 'company-1',
        displayName: 'Acme Corp',
        isPrimary: true,
      },
      {
        linkId: 'e6738884-7388-45d0-b45f-148100998a1b',
        companyId: 'company-2',
        displayName: 'Beta Holdings',
        isPrimary: false,
      },
    ])).toBe('Acme Corp (primary), Beta Holdings')
  })

  it('falls back to JSON for unknown objects', () => {
    expect(formatChangelogValue({ linkId: 'link-1', companyId: 'company-1' }))
      .toBe('{"linkId":"link-1","companyId":"company-1"}')
  })
})
