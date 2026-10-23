import fs from 'node:fs'
import path from 'node:path'

/**
 * No hook may be called after a component's early return.
 *
 * This shipped as a real crash: the campaign editor declared six hooks below its `if (loading)` guard, so the
 * first render called fewer hooks than the render right after `setLoading(false)` — React throws "Rendered more
 * hooks than during the previous render" and the page never opens. Nothing caught it: typecheck is happy, the
 * unit suite does not render React, and the integration suite only exercises the API.
 *
 * `react-hooks/rules-of-hooks` is the proper tool and cannot run here (this repo's typescript-eslint refuses the
 * installed TypeScript). This is the cheap structural stand-in.
 *
 * **The first version of this guard was weaker than this docblock**, in four ways that each let the crash it was
 * written for slip past a variant of itself:
 *
 *  - it compared the LAST hook in the file against the FIRST early return in the file, so a file holding two
 *    components mixed their positions together and could read either as clean or as broken for the wrong reason;
 *  - it only recognised hooks written as `React.useX`, so `useT()` — which this module calls in nearly every
 *    component — was invisible after an early return;
 *  - it only recognised early returns of JSX, so `if (!campaign) return null` did not count as one at all;
 *  - and it had no positive control, so a regex that had stopped matching anything would have reported a clean
 *    module for ever.
 *
 * All four are addressed below, and the fixtures at the bottom are the control: the analyser must find the
 * violation in each of them, or it is not doing anything.
 */
const MODULE_ROOT = path.resolve(__dirname, '..')

/** A top-level function declaration, which is where our components and hooks-holding helpers live. */
const TOP_LEVEL_FUNCTION = /^(?:export )?(?:default )?(?:async )?function [A-Za-z_$]/gm

/**
 * A guard that leaves the function early: JSX, `null`, `undefined`, a parenthesised expression, or nothing.
 *
 * Indented two spaces, which in our style is a component's own body — a `return` deeper than that is inside a
 * callback or a nested block and says nothing about hook order.
 */
const EARLY_RETURN = /^ {2}(?:if \([^\n]*\) \{\n {4}return(?:[ ;<]|$)|if \([^\n]*\) return(?:[ ;<]|$)|return(?:[ ;<]|$))/m

/**
 * Any hook call at the body's own indentation, whether reached through `React.` or imported bare.
 *
 * `use[A-Z]` is React's own rule for what a hook is named, so matching the convention rather than a list means a
 * hook added by this module or by the design system counts without anybody remembering to add it here.
 */
const HOOK_CALL = /^ {2}(?:(?:const|let|var) [^\n]*=\s*)?(?:React\.)?use[A-Z][A-Za-z0-9_$]*\(/gm

export type HookOrderViolation = { hookLine: number; returnLine: number }

/**
 * Per top-level function, because a file may hold several.
 *
 * Exported shape rather than a boolean so a failure names the lines: "there is a violation somewhere in this
 * file" is not something somebody can act on.
 */
function findHookOrderViolations(source: string): HookOrderViolation[] {
  const starts = [...source.matchAll(TOP_LEVEL_FUNCTION)].map((match) => match.index ?? 0)
  if (starts.length === 0) return []
  const lineOf = (index: number) => source.slice(0, index).split('\n').length

  const violations: HookOrderViolation[] = []
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1] ?? source.length
    const block = source.slice(start, end)
    const earlyReturn = EARLY_RETURN.exec(block)
    if (!earlyReturn || earlyReturn.index === undefined) continue
    for (const hook of block.matchAll(HOOK_CALL)) {
      if (hook.index === undefined || hook.index < earlyReturn.index) continue
      violations.push({ hookLine: lineOf(start + hook.index), returnLine: lineOf(start + earlyReturn.index) })
    }
  }
  return violations
}

function componentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : componentFiles(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

describe('React hook order', () => {
  const offenders: Array<{ file: string } & HookOrderViolation> = []
  let scanned = 0

  beforeAll(() => {
    for (const dir of ['backend', 'frontend', 'components']) {
      const root = path.join(MODULE_ROOT, dir)
      if (!fs.existsSync(root)) continue
      for (const file of componentFiles(root)) {
        scanned += 1
        const source = fs.readFileSync(file, 'utf8')
        for (const violation of findHookOrderViolations(source)) {
          offenders.push({ file: path.relative(MODULE_ROOT, file), ...violation })
        }
      }
    }
  })

  test('every hook call precedes its own function\'s early return', () => {
    expect(offenders).toEqual([])
  })

  /** A scan that silently found no files would pass the test above for ever. */
  test('the scan actually reaches this module\'s components', () => {
    expect(scanned).toBeGreaterThan(10)
  })

  /**
   * The positive control, which the first version of this guard lacked.
   *
   * Each fixture is a shape the old analyser waved through. If any of them stops being reported, the guard has
   * quietly stopped guarding — which is exactly how the crash it was written for reached production.
   */
  describe('the analyser can actually fire', () => {
    const cases: Array<[string, string]> = [
      ['a hook after an early JSX return', `
export default function Screen() {
  const [loading, setLoading] = React.useState(true)
  if (loading) return <Spinner />
  const [rows, setRows] = React.useState([])
  return <div>{rows.length}</div>
}
`],
      ['an imported hook after an early return, not reached through React.', `
export default function Screen() {
  const [loading] = React.useState(true)
  if (loading) return <Spinner />
  const t = useT()
  return <div>{t('x', 'x')}</div>
}
`],
      ['a hook after an early "return null"', `
export default function Screen() {
  const [campaign] = React.useState(null)
  if (!campaign) return null
  const scope = useOrganizationScopeVersion()
  return <div>{scope}</div>
}
`],
      ['a hook after an early return in the SECOND function of a file', `
function Clean() {
  const a = React.useState(1)
  return <div>{a}</div>
}

export default function Screen() {
  const [loading] = React.useState(true)
  if (loading) return <Spinner />
  const later = React.useMemo(() => 1, [])
  return <div>{later}</div>
}
`],
      ['a braced early return with the return on its own line', `
export default function Screen() {
  const [loading] = React.useState(true)
  if (loading) {
    return <Spinner />
  }
  const t = useT()
  return <div>{t('x', 'x')}</div>
}
`],
    ]

    for (const [label, source] of cases) {
      test(label, () => {
        expect(findHookOrderViolations(source).length).toBeGreaterThan(0)
      })
    }
  })

  /** And the negative control: the correct shape must not be reported, or the guard is noise. */
  describe('the analyser does not cry wolf', () => {
    test('every hook before the guard is clean', () => {
      const source = `
export default function Screen() {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [rows, setRows] = React.useState([])
  React.useEffect(() => { setLoading(false) }, [])
  if (loading) return <Spinner />
  return <div>{t('x', 'x')}{rows.length}</div>
}
`
      expect(findHookOrderViolations(source)).toEqual([])
    })

    test('a return inside a callback is not an early return', () => {
      const source = `
export default function Screen() {
  const rows = useRows()
  const visible = React.useMemo(() => rows.filter((row) => {
    if (!row.active) return false
    return true
  }), [rows])
  const t = useT()
  return <div>{visible.length}{t('x', 'x')}</div>
}
`
      expect(findHookOrderViolations(source)).toEqual([])
    })
  })
})
