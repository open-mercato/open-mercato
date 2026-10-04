import fs from 'node:fs'
import path from 'node:path'

// `text-muted-foreground` is 4.96:1 on the page background, just above the
// 4.5:1 that WCAG 2.2 SC 1.4.3 requires for text. Any opacity modifier on it
// (`/70`, `/60`, …) drops below that, and below the 3:1 of SC 1.4.11 for the
// icon of a control. A route sweep found such text on dozens of pages, so the
// modifier is allowed only where contrast requirements do not apply: disabled
// controls and purely decorative marks, each listed here with its reason.
const ALLOWED: Array<{ file: string; contains: string; reason: string }> = [
  { file: 'backend/DataTable.tsx', contains: 'ChevronsUpDown', reason: 'decorative hint next to a text label; the sort state is exposed separately' },
  { file: 'backend/filters/AdvancedFilterBuilder.tsx', contains: 'disabled:text-muted-foreground/50', reason: 'disabled control' },
  { file: 'backend/inputs/TagsInput.tsx', contains: "disabled ? 'bg-muted text-muted-foreground/80", reason: 'disabled control' },
  { file: 'primitives/time-picker.tsx', contains: 'cursor-not-allowed', reason: 'disabled control' },
  { file: 'primitives/step-indicator.tsx', contains: 'size-4 shrink-0 text-muted-foreground/50', reason: 'decorative separator between steps' },
  { file: 'primitives/rating-bar.tsx', contains: 'fill-transparent text-muted-foreground/30', reason: 'empty rating mark; the value is exposed as text' },
  { file: 'primitives/rating.tsx', contains: 'fill-transparent text-muted-foreground/30', reason: 'empty rating mark; the value is exposed as text' },
]

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('muted text keeps its contrast', () => {
  const root = path.resolve(__dirname, '..')

  it('does not lower the opacity of muted text outside the allowed cases', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      const relative = path.relative(root, file).split(path.sep).join('/')
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/text-muted-foreground\/\d+/.test(line)) return
        const allowed = ALLOWED.some((entry) => entry.file === relative && line.includes(entry.contains))
        if (!allowed) offenders.push(`${relative}:${index + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('has no stale allow-list entry', () => {
    const stale = ALLOWED.filter((entry) => {
      const file = path.join(root, entry.file)
      return !fs.existsSync(file) || !fs.readFileSync(file, 'utf8').split('\n').some((line) => /text-muted-foreground\/\d+/.test(line) && line.includes(entry.contains))
    })
    expect(stale.map((entry) => `${entry.file}: ${entry.contains}`)).toEqual([])
  })
})
