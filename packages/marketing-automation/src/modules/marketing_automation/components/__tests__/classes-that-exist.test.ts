import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every design-system class this module writes is one the stylesheet defines.
 *
 * A misspelled Tailwind class is the quietest defect there is. Tailwind emits nothing for a name it does not
 * know, the build succeeds, the lint passes, the element renders — just without the styling somebody asked
 * for. Two of them shipped here and neither made a sound:
 *
 * - `text-status-error-base`, in three places. The status scale is `bg`/`text`/`border`/`icon`/`solid`/
 *   `solid-foreground`; there is no `base`. Three error messages rendered in ordinary body colour, one of
 *   them the dashboard widget's only error affordance.
 * - `text-h3`, on two page titles. Defined nowhere in the monorepo — the titles rendered at body size.
 *
 * This checks the two families the module actually uses. It is not a general Tailwind validator: a full one
 * would need the compiled stylesheet and would fail on every arbitrary value the DS lint already refuses.
 */
const MODULE_ROOT = join(__dirname, '..', '..')

/** Roles the status token scale defines. Anything else is a name nobody wrote a rule for. */
const STATUS_ROLES = ['bg', 'text', 'border', 'icon', 'solid', 'solid-foreground']
const STATUSES = ['success', 'warning', 'error', 'info', 'neutral']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

const sources = sourceFiles(MODULE_ROOT).map((path) => ({ path, source: readFileSync(path, 'utf8') }))

describe('the classes this module writes', () => {
  it('reads the module it is meant to be checking', () => {
    expect(sources.length).toBeGreaterThan(50)
  })

  it('uses only roles the status token scale defines', () => {
    const wrong: string[] = []
    for (const { path, source } of sources) {
      for (const [, status, role] of source.matchAll(/\b(?:text|bg|border)-status-(\w+)-([\w-]+)\b/g)) {
        if (!STATUSES.includes(status) || !STATUS_ROLES.includes(role)) {
          wrong.push(`${path.slice(path.indexOf('marketing_automation/'))}: status-${status}-${role}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('writes no heading class the stylesheet does not define', () => {
    // `text-h1`…`text-h6` look like a type scale and are not one. `text-overline` IS defined and is allowed.
    const wrong = sources
      .filter(({ source }) => /\btext-h[1-6]\b/.test(source))
      .map(({ path }) => path.slice(path.indexOf('marketing_automation/')))
    expect(wrong).toEqual([])
  })
})
