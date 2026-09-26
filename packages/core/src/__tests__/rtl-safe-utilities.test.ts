import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * RTL-safe directional-utility audit.
 *
 * Physical directional Tailwind utilities are anchored to the physical edges of
 * the box, not to the writing direction: under `[dir=rtl]` — which the app shell
 * renders for Arabic (see
 * .ai/specs/2026-09-25-arabic-first-rtl-and-saudi-localization.md) — `ml-2` still
 * pads the LEFT edge, `text-left` still aligns left, and `border-r` still draws
 * on the right. Tailwind v4's logical equivalents (`ms-`, `me-`, `ps-`, `pe-`,
 * `text-start`, `text-end`, `start-`, `end-`, `border-s/e`, `rounded-s/e`) resolve
 * to the same edge in a left-to-right document and mirror in a right-to-left one,
 * so they are the only form a direction-aware UI may use.
 *
 * Deliberately out of scope, because mirroring them is a per-site semantic decision
 * rather than a rename: `translate-x-*`, `divide-x`, `bg-gradient-to-l/r` (the
 * generated gradient is `--tw-gradient-position: to right`, verified against the
 * installed Tailwind 4.3.3) and `origin-left/right` (Tailwind has no logical
 * origin). They are tracked as the spec's Phase 1b.
 *
 * `space-x-*` is *not* on that list, although an earlier revision of this file said
 * it was: Tailwind 4 compiles it to `margin-inline-start`/`margin-inline-end`, so it
 * already mirrors. Verified the same way — by compiling the utility and reading the
 * output — and left alone, because "fixing" a logical utility is churn.
 *
 * Inline `style={{ left }}`/`{{ right }}` offsets cannot be fixed by a class, so a
 * second check requires the `rtl-physical` marker on those lines as well: a measured
 * canvas coordinate or a map pin is physical on purpose, while a control anchored to
 * the sidebar edge is not.
 *
 * A line that legitimately needs a physical utility (an operator-chosen dock
 * edge, a measured canvas coordinate) opts out with an `rtl-physical` marker and
 * a reason, the same escape hatch the sibling audits use.
 *
 * Test and integration directories are out of scope: an assertion on a stale
 * class name fails loudly on its own, while production source is what needs the
 * standing audit.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const SKIP_DIRS = new Set([
  'node_modules',
  '__tests__',
  '__integration__',
  '__snapshots__',
  'generated',
  'dist',
  '.next',
  '.mercato',
  '.turbo',
  'coverage',
])
const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const OPT_OUT_MARKER = 'rtl-physical'

const SPACING_VALUE = String.raw`(?:-?\[[^\]]+\]|auto|px|\d+(?:\.\d+)?(?:\/\d+)?)`
const POSITION_VALUE = String.raw`(?:-?\[[^\]]+\]|auto|full|px|\d+(?:\.\d+)?(?:\/\d+)?)`

const VIOLATIONS: Array<{ rule: string; pattern: RegExp }> = [
  { rule: 'ms/me/ps/pe', pattern: new RegExp(`^-?(?:ml|mr|pl|pr)-${SPACING_VALUE}$`) },
  { rule: 'ms/me/ps/pe', pattern: new RegExp(`^-?scroll-(?:ml|mr|pl|pr)-${SPACING_VALUE}$`) },
  { rule: 'text-start/text-end', pattern: /^text-(?:left|right)$/ },
  { rule: 'start-/end-', pattern: new RegExp(`^-?(?:left|right)-${POSITION_VALUE}$`) },
  { rule: 'border-s/border-e', pattern: /^border-(?:l|r)(?:-.+)?$/ },
  { rule: 'rounded-s/rounded-e', pattern: /^rounded-(?:l|r)(?:-.+)?$/ },
  { rule: 'rounded-ss/-se/-es/-ee', pattern: /^rounded-(?:tl|tr|bl|br)(?:-.+)?$/ },
  { rule: 'float-start/float-end', pattern: /^float-(?:left|right)$/ },
]

const STRING_LITERAL = /(`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/g

/**
 * An inline offset on the physical axis inside a `style={{ … }}` object:
 * `left`, `right`, `marginLeft`, `marginRight`, `paddingLeft`, `paddingRight`,
 * `borderLeft`, `borderRight`. Logical alternatives exist (`insetInlineStart`,
 * `marginInlineStart`) and are the fix; the sites where a physical value is the point
 * carry the marker with a reason.
 *
 * The scan only looks inside style objects, because `left`/`right` are also ordinary
 * identifier names (`function equals(left, right)`), which are none of this audit's
 * business.
 */
const INLINE_PHYSICAL_OFFSET =
  /\b(?:left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\s*:/

const STYLE_OBJECT_OPEN = /style=\{?\{/
const STYLE_OBJECT_CLOSE = /\}\}/

function isDir(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

function walk(dir: string, acc: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walk(full, acc)
      continue
    }
    if (!SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension))) continue
    if (/\.generated\.(ts|tsx)$/.test(name)) continue
    acc.push(full)
  }
}

function discoverSourceRoots(): string[] {
  const roots: string[] = []
  for (const workspace of ['packages', 'apps']) {
    let entries: string[]
    try {
      entries = readdirSync(join(repoRoot, workspace))
    } catch {
      continue
    }
    for (const entry of entries) {
      for (const candidate of [
        join(repoRoot, workspace, entry, 'src'),
        join(repoRoot, workspace, entry, 'template', 'src'),
      ]) {
        if (isDir(candidate)) roots.push(candidate)
      }
    }
  }
  return roots
}

function physicalToken(token: string): string | null {
  if (/^\s*$/.test(token)) return null
  if (token.startsWith('$')) return null
  const body = token.startsWith('!') ? token.slice(1) : token
  const segments = body.split(':')
  const candidate = segments[segments.length - 1]
  if (!candidate) return null
  for (const { pattern } of VIOLATIONS) {
    if (pattern.test(candidate)) return candidate
  }
  return null
}

describe('directional Tailwind utilities must be logical (RTL-safe)', () => {
  const files: string[] = []
  for (const root of discoverSourceRoots()) walk(root, files)

  it('discovers source files to audit', () => {
    expect(files.length).toBeGreaterThan(1000)
  })

  it('never uses a physical directional utility outside a marked line', () => {
    const violations: string[] = []

    for (const full of files) {
      const rel = relative(repoRoot, full).split(sep).join('/')
      const lines = readFileSync(full, 'utf8').split('\n')

      lines.forEach((line, index) => {
        if (line.includes(OPT_OUT_MARKER)) return
        const literals = line.match(STRING_LITERAL)
        if (!literals) return
        for (const literal of literals) {
          const value = literal.slice(1, -1)
          for (const token of value.split(/\s+/)) {
            const offender = physicalToken(token)
            if (offender) violations.push(`${rel}:${index + 1}: ${offender}`)
          }
        }
      })
    }

    expect(violations).toEqual([])
  })

  it('marks inline physical offsets, which no class can fix', () => {
    const violations: string[] = []

    for (const full of files) {
      const rel = relative(repoRoot, full).split(sep).join('/')
      const lines = readFileSync(full, 'utf8').split('\n')
      let insideStyleObject = false

      lines.forEach((line, index) => {
        const opens = STYLE_OBJECT_OPEN.test(line)
        if (opens) insideStyleObject = true
        const inStyleObject = insideStyleObject
        if (STYLE_OBJECT_CLOSE.test(line)) insideStyleObject = false
        if (!inStyleObject) return
        // A style object has no room for a trailing comment, so the marker usually
        // sits on the line above the property it excuses.
        if (line.includes(OPT_OUT_MARKER) || lines[index - 1]?.includes(OPT_OUT_MARKER)) return
        if (!INLINE_PHYSICAL_OFFSET.test(line)) return
        violations.push(`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`)
      })
    }

    expect(violations).toEqual([])
  })
})
