import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'AvailabilityRulesEditor.tsx'),
  'utf8',
)

describe('AvailabilityRulesEditor accessibility', () => {
  it('identifies each date-specific removal control by date', () => {
    expect(source).toContain('aria-label={`${listLabels.removeWindow} ${date}`}')
  })
})
