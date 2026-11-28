import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const packageRoot = path.resolve(__dirname, '../..')

test('the built package supports its advertised public root import', () => {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    exports: { '.': { types: string } }
  }
  expect(existsSync(path.join(packageRoot, manifest.exports['.'].types))).toBe(true)
  execFileSync(process.execPath, ['build.mjs'], { cwd: packageRoot, timeout: 60_000 })
  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    "import { metadata } from '@open-mercato/marketing-automation'; console.log(JSON.stringify(metadata));",
  ], { cwd: packageRoot, timeout: 30_000, encoding: 'utf8' })
  expect(JSON.parse(output)).toMatchObject({ name: 'marketing_automation', title: 'Marketing Automation' })
}, 90_000)
