import * as fs from 'fs'
import * as path from 'path'

const repoRoot = path.resolve(__dirname, '../../../../..')

const read = (relative: string): string =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8')

describe('heavy libraries are lazy-loaded', () => {
  it('ScheduleView does not statically import react-big-calendar', () => {
    const source = read('packages/ui/src/backend/schedule/ScheduleView.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]react-big-calendar['"]/m)
    expect(source).toMatch(/next\/dynamic/)
  })

  it('MarkdownContent does not statically import react-markdown', () => {
    const source = read('packages/ui/src/backend/markdown/MarkdownContent.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]react-markdown['"]/m)
    expect(source).toMatch(/import\(['"]react-markdown['"]\)/)
  })

  it('MarkdownContent avoids next/dynamic so CLI/Node bootstrap can import it', () => {
    const source = read('packages/ui/src/backend/markdown/MarkdownContent.tsx')
    expect(source).not.toMatch(/next\/dynamic/)
  })

  it('CrudForm does not statically import remark-gfm', () => {
    const source = read('packages/ui/src/backend/CrudForm.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]remark-gfm['"]/m)
    expect(source).toMatch(/import\(['"]remark-gfm['"]\)/)
  })

  it('resources resource-types list page does not import markdown libraries', () => {
    const source = read(
      'packages/core/src/modules/resources/backend/resources/resource-types/page.tsx',
    )
    expect(source).not.toMatch(/from\s+['"]react-markdown['"]/)
    expect(source).not.toMatch(/from\s+['"]remark-gfm['"]/)
    expect(source).toMatch(/markdownToPlainText/)
  })

  it('planner availability-rulesets list page does not import markdown libraries', () => {
    const source = read(
      'packages/core/src/modules/planner/backend/planner/availability-rulesets/page.tsx',
    )
    expect(source).not.toMatch(/from\s+['"]react-markdown['"]/)
    expect(source).not.toMatch(/from\s+['"]remark-gfm['"]/)
    expect(source).toMatch(/markdownToPlainText/)
  })
})
