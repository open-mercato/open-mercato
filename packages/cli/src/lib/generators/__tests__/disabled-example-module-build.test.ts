/**
 * Integration regression test for issue #601: disabling the example module
 * must not break the app build.
 *
 * Disables example in modules.ts, runs generation and typecheck, and asserts
 * both succeed. This is slower (~25s) and exercises the real build pipeline.
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCommandAndCapture } from '../../testing/runtime-utils'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const APP_DIR = path.join(REPO_ROOT, 'apps', 'mercato')
const MODULES_TS_PATH = path.join(APP_DIR, 'src', 'modules.ts')

describe('Disabled example module: typecheck passes (#601)', () => {
  let originalModulesTs: string

  beforeAll(() => {
    originalModulesTs = fs.readFileSync(MODULES_TS_PATH, 'utf8')
  })

  afterAll(() => {
    fs.writeFileSync(MODULES_TS_PATH, originalModulesTs)
  })

  it(
    'disabling example and regenerating still passes typecheck',
    async () => {
      // 1. Disable example module
      const disabledContent = originalModulesTs.replace(
        /\{\s*id:\s*['"]example['"]\s*,\s*from:\s*['"]@app['"]\s*\}/,
        '// { id: \'example\', from: \'@app\' } // disabled for #601 regression test',
      )
      expect(disabledContent).not.toBe(originalModulesTs)
      fs.writeFileSync(MODULES_TS_PATH, disabledContent)

      // 2. Run generation
      const generate = await runCommandAndCapture('yarn', ['generate'])
      expect(generate.code).toBe(0)

      // 3. Run typecheck
      const typecheck = await runCommandAndCapture(
        'npx',
        ['tsc', '--noEmit', '--pretty', 'false', '-p', path.join(APP_DIR, 'tsconfig.json')],
      )
      if (typecheck.code !== 0) {
        const errorLines = typecheck.stdout
          .split('\n')
          .filter((line) => line.includes('error TS'))
          .slice(0, 10)
        fail(
          `Typecheck failed with example disabled (issue #601 regression).\n`
          + `First errors:\n${errorLines.join('\n')}`,
        )
      }

      // 4. Restore and regenerate
      fs.writeFileSync(MODULES_TS_PATH, originalModulesTs)
      const restore = await runCommandAndCapture('yarn', ['generate'])
      expect(restore.code).toBe(0)
    },
    120_000,
  )
})
