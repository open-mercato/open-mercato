import fs from 'node:fs'
import path from 'node:path'

describe('AppProviders import graph', () => {
  it('uses direct UI imports instead of the broad package barrel', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/AppProviders.tsx'), 'utf8')

    expect(source).not.toContain("from '@open-mercato/ui'")
    expect(source).toContain("@open-mercato/ui/theme/ThemeProvider")
    expect(source).toContain("@open-mercato/ui/theme/QueryProvider")
    expect(source).toContain("@open-mercato/ui/frontend/Layout")
    expect(source).toContain("@open-mercato/ui/frontend/AuthFooter")
  })
})
