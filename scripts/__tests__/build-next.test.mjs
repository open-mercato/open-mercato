import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const wrappers = ['apps/mercato/scripts/build-next.mjs', 'packages/create-app/template/scripts/build-next.mjs']
function fixture(t, wrapper) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-build-next-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.copyFileSync(path.join(root, wrapper), path.join(dir, 'scripts/build-next.mjs'))
  fs.mkdirSync(path.join(dir, 'node_modules/next/dist/bin'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules/next/dist/bin/next'), `
    if (process.env.WAIT_FOR_SIGNAL) {
      process.once('SIGTERM', () => { process.stdout.write('forwarded\\n'); process.kill(process.pid, 'SIGTERM') })
      process.stdout.write('ready\\n')
      setInterval(() => {}, 1000)
    } else {
      process.stdout.write(JSON.stringify({ options: process.env.NODE_OPTIONS, nodeEnv: process.env.NODE_ENV, args: process.argv.slice(2) }) + '\\n')
      process.stderr.write('child stderr\\n')
      process.exitCode = Number(process.env.STUB_EXIT_CODE || 0)
    }
  `)
  const env = { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=512' }
  delete env.OM_BUILD_NODE_OPTIONS
  delete env.WAIT_FOR_SIGNAL
  delete env.STUB_EXIT_CODE
  return { dir, env, script: path.join(dir, 'scripts/build-next.mjs') }
}
for (const wrapper of wrappers) {
  test(`${wrapper}: host default, explicit web/container heaps and literal arguments`, (t) => {
    const f = fixture(t, wrapper)
    for (const options of [undefined, '--max-old-space-size=8192', '--max-old-space-size=4096']) {
      const env = { ...f.env, ...(options === undefined ? {} : { OM_BUILD_NODE_OPTIONS: options }) }
      const r = spawnSync(process.execPath, [f.script, '--webpack', 'path with spaces', '$literal'], { cwd: f.dir, env, encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      assert.deepEqual(JSON.parse(r.stdout), { options: options ?? '--max-old-space-size=8192', nodeEnv: 'production', args: ['build', '--webpack', 'path with spaces', '$literal'] })
      assert.equal(r.stderr, 'child stderr\n')
    }
  })
  test(`${wrapper}: forwards nonzero child exit`, (t) => {
    const f = fixture(t, wrapper)
    const r = spawnSync(process.execPath, [f.script], { cwd: f.dir, env: { ...f.env, STUB_EXIT_CODE: '7' }, encoding: 'utf8' })
    assert.equal(r.status, 7)
    assert.equal(r.signal, null)
  })
  test(`${wrapper}: forwards SIGTERM and preserves signal termination`, { skip: process.platform === 'win32', timeout: 10000 }, async (t) => {
    const f = fixture(t, wrapper)
    const child = spawn(process.execPath, [f.script], { cwd: f.dir, env: { ...f.env, WAIT_FOR_SIGNAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    t.after(() => child.kill('SIGKILL'))
    let output = ''
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('ready\n')) resolve() })
    })
    const exit = once(child, 'exit')
    child.kill('SIGTERM')
    assert.deepEqual(await exit, [null, 'SIGTERM'])
    assert.match(output, /forwarded\n/)
  })
}
