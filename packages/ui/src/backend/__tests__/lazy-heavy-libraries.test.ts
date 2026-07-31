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

  it('CrudForm does not statically import the heavy markdown editor', () => {
    const source = read('packages/ui/src/backend/CrudForm.tsx')
    expect(source).not.toMatch(/from\s+['"]@mdxeditor\/editor['"]/)
    expect(source).toMatch(/from\s+['"]\.\/inputs\/MarkdownField['"]/)
  })

  it('MarkdownField lazy-loads MdxEditorImpl and does not statically import it', () => {
    const source = read('packages/ui/src/backend/inputs/MarkdownField.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]\.\/MdxEditorImpl['"]/m)
    expect(source).toMatch(/import\(['"]\.\/MdxEditorImpl['"]\)/)
    expect(source).toMatch(/next\/dynamic/)
  })

  it('MdxEditorImpl owns the @mdxeditor/editor runtime import and CSS', () => {
    const source = read('packages/ui/src/backend/inputs/MdxEditorImpl.tsx')
    expect(source).toMatch(/from\s+['"]@mdxeditor\/editor['"]/)
    expect(source).toMatch(/['"]@mdxeditor\/editor\/style\.css['"]/)
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

  it('BarChart wrapper does not statically import recharts', () => {
    const source = read('packages/ui/src/backend/charts/BarChart.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]recharts['"]/m)
    expect(source).toMatch(/next\/dynamic/)
    expect(source).toMatch(/import\(['"]\.\/BarChartImpl['"]\)/)
  })

  it('LineChart wrapper does not statically import recharts', () => {
    const source = read('packages/ui/src/backend/charts/LineChart.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]recharts['"]/m)
    expect(source).toMatch(/next\/dynamic/)
    expect(source).toMatch(/import\(['"]\.\/LineChartImpl['"]\)/)
  })

  it('PieChart wrapper does not statically import recharts', () => {
    const source = read('packages/ui/src/backend/charts/PieChart.tsx')
    expect(source).not.toMatch(/^[^\n/]*import\s+[^'\n]+from\s+['"]recharts['"]/m)
    expect(source).toMatch(/next\/dynamic/)
    expect(source).toMatch(/import\(['"]\.\/PieChartImpl['"]\)/)
  })

  it('recharts is only imported by the chart *Impl modules', () => {
    const impls = ['BarChartImpl', 'LineChartImpl', 'PieChartImpl']
    for (const name of impls) {
      const source = read(`packages/ui/src/backend/charts/${name}.tsx`)
      expect(source).toMatch(/from\s+['"]recharts['"]/)
    }
  })

  it('WorkflowGraph wrapper has only type-only @xyflow/react imports', () => {
    const source = read(
      'packages/core/src/modules/workflows/components/WorkflowGraph.tsx',
    )
    expect(source).not.toMatch(
      /^[^\n/]*import\s+(?!type\b)[^'\n]+from\s+['"]@xyflow\/react['"]/m,
    )
    expect(source).toMatch(/next\/dynamic/)
    expect(source).toMatch(/import\(['"]\.\/WorkflowGraphImpl['"]\)/)
  })

  it('WorkflowGraphImpl owns the @xyflow/react runtime import and CSS', () => {
    const source = read(
      'packages/core/src/modules/workflows/components/WorkflowGraphImpl.tsx',
    )
    expect(source).toMatch(/from\s+['"]@xyflow\/react['"]/)
    expect(source).toMatch(/['"]@xyflow\/react\/dist\/style\.css['"]/)
  })

  it('globals.css no longer eagerly imports @xyflow/react styles', () => {
    const source = read('apps/mercato/src/app/globals.css')
    expect(source).not.toMatch(/@xyflow\/react\/dist\/style\.css/)
  })

  it('globals.css no longer eagerly imports react-big-calendar styles', () => {
    const source = read('apps/mercato/src/app/globals.css')
    expect(source).not.toMatch(/react-big-calendar\/lib\/css/)
  })

  it('ScheduleCalendar owns the react-big-calendar CSS import', () => {
    const source = read('packages/ui/src/backend/schedule/ScheduleCalendar.tsx')
    expect(source).toMatch(/import\s+['"]react-big-calendar\/lib\/css\/react-big-calendar\.css['"]/)
  })

  it('AttachmentContentPreview does not statically import react-markdown or remark-gfm', () => {
    const source = read(
      'packages/core/src/modules/attachments/components/AttachmentContentPreview.tsx',
    )
    expect(source).not.toMatch(/from\s+['"]react-markdown['"]/)
    expect(source).not.toMatch(/from\s+['"]remark-gfm['"]/)
  })
})
