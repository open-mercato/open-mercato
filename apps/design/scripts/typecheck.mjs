import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { appRoot } from './workspace-resolve.mjs'

const require = createRequire(import.meta.url)
const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', path.join(appRoot, 'tsconfig.json'), '--pretty', 'false'], {
  cwd: appRoot,
  encoding: 'utf8',
})

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
const diagnostics = output.split('\n').filter((line) => /^\S.*\(\d+,\d+\): error TS\d+/.test(line))
const own = diagnostics.filter((line) => !line.startsWith('../'))
const external = diagnostics.length - own.length

for (const line of own) process.stderr.write(`${line}\n`)
process.stdout.write(`[design] typecheck: ${own.length} error(s) in apps/design, ${external} error(s) in imported workspace sources ignored\n`)
if (diagnostics.length === 0 && result.status !== 0) {
  process.stderr.write(output)
  process.exit(result.status ?? 1)
}
process.exit(own.length > 0 ? 1 : 0)
