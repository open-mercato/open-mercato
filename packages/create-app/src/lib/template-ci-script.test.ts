import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  GATE_STEPS,
  SKIP_NEXT_BUILD_TYPECHECK_ENV,
  NEXT_BUILD_NODE_OPTIONS_ENV,
  CI_BUILD_NODE_OPTIONS,
  STUB_LOCKFILE_MESSAGE,
  checkLockfile,
  isStubLockfile,
  prepareEnv,
  runGate,
  stepEnv,
  // @ts-expect-error The standalone template script is plain ESM by design.
} from '../../template/scripts/ci.mjs'

type StepCall = { step: string; env: Record<string, string | undefined> }

const ciScriptPath = fileURLToPath(new URL('../../template/scripts/ci.mjs', import.meta.url))
const lockfileTemplate = fs.readFileSync(
  fileURLToPath(new URL('../../template/yarn.lock.template', import.meta.url)),
  'utf8',
)
const renderedStubLockfile = lockfileTemplate.replace(/\{\{APP_NAME\}\}/g, 'ci-fixture-app')
const resolvedLockfile = `${renderedStubLockfile}
"left-pad@npm:^1.3.0":
  version: 1.3.0
  resolution: "left-pad@npm:1.3.0"
  checksum: 10c0/abc
  languageName: node
  linkType: hard
`

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'template-ci-script-'))
}

function withTempDir(run: (dir: string) => void) {
  const dir = makeTempDir()
  try {
    run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function recordingGate(exitCodes: Record<string, number> = {}, env: Record<string, string | undefined> = {}) {
  const calls: StepCall[] = []
  const lines: string[] = []
  const errors: string[] = []
  const result = runGate({
    runStep: (step: string, options: { env?: Record<string, string | undefined> } = {}) => {
      calls.push({ step, env: options.env ?? {} })
      return exitCodes[step] ?? 0
    },
    log: (line: string) => {
      lines.push(line)
    },
    logError: (line: string) => {
      errors.push(line)
    },
    env,
  })
  return { calls, lines, errors, result }
}

function runCiScript(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [ciScriptPath, ...args], { cwd, encoding: 'utf8' })
}

test('the gate runs generate, typecheck, lint, ds:check, test, build in that order', () => {
  assert.deepEqual([...GATE_STEPS], ['generate', 'typecheck', 'lint', 'ds:check', 'test', 'build'])

  const { calls, lines, errors, result } = recordingGate()
  assert.deepEqual(calls.map((call) => call.step), [...GATE_STEPS])
  assert.deepEqual(result, { ok: true, failedStep: null, exitCode: 0 })
  assert.deepEqual(errors, [])
  assert.match(lines.at(-1) ?? '', /yarn ci passed: 6 steps in /)
})

test('the gate stops at the first failing step and reports its exit code', () => {
  const { calls, errors, result } = recordingGate({ typecheck: 2, lint: 1 })

  assert.deepEqual(calls.map((call) => call.step), ['generate', 'typecheck'])
  assert.deepEqual(result, { ok: false, failedStep: 'typecheck', exitCode: 2 })
  assert.ok(errors.includes('yarn ci failed at "typecheck" (exit 2)'), errors.join('\n'))
})

test('a failing step without a usable exit code is reported as exit 1', () => {
  const { result, errors } = recordingGate({ generate: -1 })

  assert.deepEqual(result, { ok: false, failedStep: 'generate', exitCode: 1 })
  assert.ok(errors.includes('yarn ci failed at "generate" (exit 1)'), errors.join('\n'))
})

test('only the build step skips the redundant Next type check', () => {
  const { calls } = recordingGate({}, { PATH: '/usr/bin' })

  for (const call of calls) {
    if (call.step === 'build') {
      assert.equal(call.env[SKIP_NEXT_BUILD_TYPECHECK_ENV], '1')
      assert.equal(call.env[NEXT_BUILD_NODE_OPTIONS_ENV], CI_BUILD_NODE_OPTIONS)
      assert.equal(call.env.PATH, '/usr/bin')
    } else {
      assert.equal(call.env[SKIP_NEXT_BUILD_TYPECHECK_ENV], undefined, `${call.step} must type-check normally`)
      assert.equal(call.env[NEXT_BUILD_NODE_OPTIONS_ENV], undefined, `${call.step} keeps its own heap`)
    }
  }

  const baseEnv = { PATH: '/usr/bin' }
  assert.equal(stepEnv('typecheck', baseEnv), baseEnv)
  assert.equal(stepEnv('build', baseEnv)[SKIP_NEXT_BUILD_TYPECHECK_ENV], '1')
  assert.equal(Object.hasOwn(baseEnv, SKIP_NEXT_BUILD_TYPECHECK_ENV), false, 'stepEnv must not mutate its input')
})

test('the template build script lets the gate lower its heap after the default', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL('../../template/package.json.template', import.meta.url)), 'utf8'),
  )
  const buildScript: string = packageJson.scripts.build
  const defaultHeapIndex = buildScript.indexOf('--max-old-space-size=8192')
  const overrideIndex = buildScript.indexOf(`\${${NEXT_BUILD_NODE_OPTIONS_ENV}:-}`)
  assert.ok(defaultHeapIndex >= 0, buildScript)
  assert.ok(overrideIndex > defaultHeapIndex, 'the override must follow the default so the last --max-old-space-size wins')
  assert.ok(!buildScript.includes(`$${NEXT_BUILD_NODE_OPTIONS_ENV} `), 'Yarn\'s shell rejects an unbound variable, so the override needs the :- default form')
  assert.match(CI_BUILD_NODE_OPTIONS, /^--max-old-space-size=\d+$/)
})

test('the template next.config only skips the build type check when the gate asks for it', () => {
  const nextConfigSource = fs.readFileSync(
    fileURLToPath(new URL('../../template/next.config.ts', import.meta.url)),
    'utf8',
  )
  assert.match(
    nextConfigSource,
    /typescript:\s*\{\s*ignoreBuildErrors:\s*process\.env\.OM_SKIP_NEXT_BUILD_TYPECHECK === '1'\s*\}/,
  )
})

test('the template package.json exposes the gate as `yarn ci`', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL('../../template/package.json.template', import.meta.url)), 'utf8'),
  ) as { scripts?: Record<string, string> }
  assert.equal(packageJson.scripts?.ci, 'node ./scripts/ci.mjs')
  for (const step of GATE_STEPS) {
    assert.ok(packageJson.scripts?.[step], `the gate runs "${step}", which the template must define`)
  }
})

test('--prepare-env copies .env.example when .env is absent', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.env.example'), 'DATABASE_URL=postgres://example\n')
    const lines: string[] = []

    const result = prepareEnv({
      rootDir: dir,
      log: (line: string) => {
        lines.push(line)
      },
    })

    assert.deepEqual(result, { created: true, reason: 'created' })
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'DATABASE_URL=postgres://example\n')
    assert.ok(lines.every((line) => !line.includes('postgres://example')), 'must never print env values')
  })
})

test('--prepare-env never overwrites an existing .env', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.env.example'), 'DATABASE_URL=postgres://example\n')
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://mine\n')

    const result = prepareEnv({ rootDir: dir, log: () => {} })
    assert.deepEqual(result, { created: false, reason: 'exists' })
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'DATABASE_URL=postgres://mine\n')

    const cli = runCiScript(dir, ['--prepare-env'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'DATABASE_URL=postgres://mine\n')
    assert.ok(!cli.stdout.includes('postgres://'), 'must never print env values')
  })
})

test('--prepare-env is a no-op when there is no .env.example', () => {
  withTempDir((dir) => {
    const cli = runCiScript(dir, ['--prepare-env'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(fs.existsSync(path.join(dir, '.env')), false)
  })
})

test('the rendered scaffold lockfile is recognized as the stub', () => {
  assert.equal(isStubLockfile(renderedStubLockfile), true)
  assert.equal(isStubLockfile(resolvedLockfile), false)
})

test('--check-lockfile rejects a missing or stub yarn.lock and accepts a resolved one', () => {
  withTempDir((dir) => {
    assert.deepEqual(checkLockfile({ rootDir: dir }), { ok: false, message: STUB_LOCKFILE_MESSAGE })

    fs.writeFileSync(path.join(dir, 'yarn.lock'), renderedStubLockfile)
    assert.deepEqual(checkLockfile({ rootDir: dir }), { ok: false, message: STUB_LOCKFILE_MESSAGE })

    fs.writeFileSync(path.join(dir, 'yarn.lock'), resolvedLockfile)
    assert.equal(checkLockfile({ rootDir: dir }).ok, true)
  })
})

test('the script exits with the right codes for --check-lockfile', () => {
  withTempDir((dir) => {
    const missing = runCiScript(dir, ['--check-lockfile'])
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /yarn\.lock is still the placeholder generated by create-mercato-app/)

    fs.writeFileSync(path.join(dir, 'yarn.lock'), renderedStubLockfile)
    const stub = runCiScript(dir, ['--check-lockfile'])
    assert.equal(stub.status, 1)
    assert.match(stub.stderr, /Run "yarn install" locally and commit yarn\.lock\./)

    fs.writeFileSync(path.join(dir, 'yarn.lock'), resolvedLockfile)
    const resolved = runCiScript(dir, ['--check-lockfile'])
    assert.equal(resolved.status, 0, resolved.stderr)
  })
})

test('an unknown flag prints usage and exits 2', () => {
  withTempDir((dir) => {
    const cli = runCiScript(dir, ['--nope'])
    assert.equal(cli.status, 2)
    assert.match(cli.stderr, /Usage: node scripts\/ci\.mjs/)
  })
})
