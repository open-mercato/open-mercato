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
 * installed TypeScript). This is the cheap structural stand-in: in our own style a component's early guards are
 * at two-space indentation, and every hook call sits at the same level, so comparing positions is enough.
 */
const MODULE_ROOT = path.resolve(__dirname, '..')
const EARLY_RETURN = /^ {2}(?:if \([^\n]*\) \{\n {4}return <|if \([^\n]*\) return <|return <)/m
const HOOK_CALL = /^ {2}(?:const [^\n]*= )?React\.use[A-Z]/gm

function componentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : componentFiles(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

describe('React hook order', () => {
  const offenders: Array<{ file: string; hookAt: number; returnAt: number }> = []

  beforeAll(() => {
    for (const dir of ['backend', 'frontend', 'components']) {
      const root = path.join(MODULE_ROOT, dir)
      if (!fs.existsSync(root)) continue
      for (const file of componentFiles(root)) {
        const source = fs.readFileSync(file, 'utf8')
        const earlyReturn = EARLY_RETURN.exec(source)
        if (!earlyReturn) continue
        const lastHook = [...source.matchAll(HOOK_CALL)].at(-1)
        if (!lastHook || lastHook.index === undefined) continue
        if (lastHook.index > earlyReturn.index) {
          offenders.push({
            file: path.relative(MODULE_ROOT, file),
            hookAt: source.slice(0, lastHook.index).split('\n').length,
            returnAt: source.slice(0, earlyReturn.index).split('\n').length,
          })
        }
      }
    }
  })

  test('every hook call precedes the first early return', () => {
    expect(offenders).toEqual([])
  })
})
