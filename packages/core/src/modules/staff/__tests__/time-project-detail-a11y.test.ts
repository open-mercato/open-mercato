import fs from 'node:fs'
import path from 'node:path'

const detailPage = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'staff', 'time-tracking', 'projects', '[id]', 'page.tsx'),
  'utf8',
)

describe('time project detail accessibility', () => {
  it('gives the icon-only back link an accessible name', () => {
    expect(detailPage).toMatch(
      /<Link[\s\S]*?href=\{BACK_HREF\}[\s\S]*?aria-label=\{t\('staff\.timesheets\.projects\.actions\.backToList', 'Back to projects'\)\}[\s\S]*?>[\s\S]*?<ArrowLeft/,
    )
  })
})
