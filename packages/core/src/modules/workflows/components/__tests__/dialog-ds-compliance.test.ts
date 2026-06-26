import fs from 'node:fs'
import path from 'node:path'

const dialogFiles = [
  'src/modules/workflows/components/EdgeEditDialog.tsx',
  'src/modules/workflows/components/NodeEditDialog.tsx',
]

const tailwindColorFamilies = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|')

const hardcodedTailwindColorShadePattern = new RegExp(
  "(?:^|[\\s\"'`])(?:[\\w-]+:)*(?:[\\w-]+-)?(?:" +
    tailwindColorFamilies +
    ')-\\d{2,3}(?:\\b|/)',
)

const forbiddenPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: 'raw <input> control', pattern: /<input\b/ },
  { label: 'raw <textarea> control', pattern: /<textarea\b/ },
  { label: 'raw <select> control', pattern: /<select\b/ },
  { label: 'raw <button> element', pattern: /<button\b/ },
  { label: 'inline <svg> icon', pattern: /<svg\b/ },
  { label: 'hardcoded color shade', pattern: hardcodedTailwindColorShadePattern },
]

function findViolations(filePath: string) {
  const source = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8')
  return source.split('\n').flatMap((line, index) =>
    forbiddenPatterns
      .filter(({ pattern }) => pattern.test(line))
      .map(({ label }) => `${filePath}:${index + 1} ${label}: ${line.trim()}`),
  )
}

describe('workflow visual editor dialog DS compliance', () => {
  test.each(dialogFiles)('%s uses shared DS primitives and semantic tokens', (filePath) => {
    expect(findViolations(filePath)).toEqual([])
  })
})
