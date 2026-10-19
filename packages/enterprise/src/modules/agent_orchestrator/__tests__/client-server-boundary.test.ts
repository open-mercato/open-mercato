/**
 * A `"use client"` module must not import a package ROOT whose index reaches
 * server-only code.
 *
 * The agentic-tasks pages imported `validateCronExpression` from
 * `@open-mercato/scheduler`. That index also exports `SchedulerService`, so the
 * client bundle transitively pulled `shared/lib/i18n/server` and its
 * `require('server-only')`, and the dev server failed every route that loaded
 * the page:
 *
 *   'server-only' cannot be imported from a Client Component module
 *
 * The failure surfaces at BUILD time in a route far from the offending file
 * (the trace above pointed at `/api/auth/login`), which is why it is worth a
 * cheap static guard rather than trusting review to catch the next one.
 *
 * The rule is about package ROOTS specifically: a deep import such as
 * `@open-mercato/scheduler/modules/scheduler/lib/cronParser` pulls one module
 * and is fine — that is the fix, not a workaround.
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import fg from 'fast-glob'

const MODULE_ROOT = join(__dirname, '..')

/**
 * Package roots whose index is known to reach server-only code. Add a package
 * here when its index gains a server-only path; the deep-import escape hatch
 * keeps individual helpers usable from the browser.
 */
const SERVER_REACHING_PACKAGE_ROOTS = ['@open-mercato/scheduler']

function isClientModule(source: string): boolean {
  const head = source.slice(0, 200)
  return head.includes("'use client'") || head.includes('"use client"')
}

describe('client/server import boundary', () => {
  const files = fg.sync(['**/*.{ts,tsx}'], {
    cwd: MODULE_ROOT,
    absolute: true,
    ignore: ['**/__tests__/**', '**/__integration__/**'],
  })

  it('scans a meaningful number of module files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('no "use client" module imports a server-reaching package root', () => {
    const violations: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!isClientModule(source)) continue
      for (const pkg of SERVER_REACHING_PACKAGE_ROOTS) {
        // The ROOT only: `from '<pkg>'`, never `from '<pkg>/deep/path'`.
        const rootImport = new RegExp(`from\\s+['"]${pkg.replace(/[/\\-]/g, '\\$&')}['"]`)
        if (rootImport.test(source)) {
          violations.push(`${relative(MODULE_ROOT, file).split(sep).join('/')} → ${pkg}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
