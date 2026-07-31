import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

// TEMPORARY (TypeScript 7 migration): the app's `typescript` package is pinned to
// JS TypeScript 6 because `next build` type-checks the app with the JavaScript
// compiler API that native TS 7 no longer ships (Next 16.2). To keep `yarn
// typecheck` fast, run the native TS 7 compiler here instead — it is installed
// under the `typescript-native` npm alias. Remove this script (and the alias) and
// restore `"typecheck": "tsc --noEmit"` once Next 16.3 adds native tsgo build
// support and the app can move fully to native TS 7.
const require = createRequire(import.meta.url)
const pkgDir = path.dirname(require.resolve('typescript-native/package.json'))
const tsc = path.join(pkgDir, 'bin', 'tsc')

const result = spawnSync(process.execPath, [tsc, '--noEmit', ...process.argv.slice(2)], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
