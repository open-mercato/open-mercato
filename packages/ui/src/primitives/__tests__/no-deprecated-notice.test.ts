import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..')

const ALLOWED_FILES = new Set(
  [
    'packages/ui/src/primitives/Notice.tsx',
    'packages/ui/src/primitives/ErrorNotice.tsx',
    'packages/ui/src/primitives/__tests__/no-deprecated-notice.test.ts',
  ].map((relative) => path.join(REPO_ROOT, relative)),
)

const IGNORED_DIRS = new Set([
  'node_modules',
  '.mercato',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.yarn',
  '.git',
  '.ai',
])

function collectSourceFiles(start: string, out: string[]) {
  const entries = fs.readdirSync(start, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const full = path.join(start, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue
    out.push(full)
  }
}

describe('Deprecated <Notice> JSX guard', () => {
  it('has no direct <Notice ...> JSX usages outside the allow-list', () => {
    const files: string[] = []
    for (const dir of ['apps', 'packages']) {
      const fullDir = path.join(REPO_ROOT, dir)
      if (fs.existsSync(fullDir)) collectSourceFiles(fullDir, files)
    }

    const noticeUsageRegex = /<Notice\b/

    const violations: Array<{ file: string; line: number; snippet: string }> = []
    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue
      if (/__tests__/.test(file)) continue
      const contents = fs.readFileSync(file, 'utf8')
      if (!noticeUsageRegex.test(contents)) continue

      const lines = contents.split('\n')
      lines.forEach((lineContent, index) => {
        if (noticeUsageRegex.test(lineContent)) {
          violations.push({
            file: path.relative(REPO_ROOT, file),
            line: index + 1,
            snippet: lineContent.trim().slice(0, 160),
          })
        }
      })
    }

    expect(violations).toEqual([])
  })
})
