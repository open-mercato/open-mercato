import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { DOCKER_PROBE_TIMEOUT_MS, classifyDockerProbe } from '../dev-docker-availability.mjs'

test('reports the running container names when docker answers', () => {
  const probe = classifyDockerProbe({ status: 0, stdout: 'mercato-opencode\nmercato-postgres\n' })

  assert.equal(probe.available, true)
  assert.deepEqual(probe.names, ['mercato-opencode', 'mercato-postgres'])
})

test('reports an empty list when docker answers with no running containers', () => {
  const probe = classifyDockerProbe({ status: 0, stdout: '\n' })

  assert.equal(probe.available, true)
  assert.deepEqual(probe.names, [])
})

test('treats a missing docker CLI as unavailable rather than an error', () => {
  const probe = classifyDockerProbe({ error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) })

  assert.equal(probe.available, false)
  assert.equal(probe.reason, 'cli-missing')
  assert.match(probe.detail, /not installed/)
})

// Regression: an unresponsive daemon used to hang `spawnSync` forever, freezing
// the splash server and the runtime collector along with it.
test('treats an unresponsive daemon as unavailable', () => {
  const probe = classifyDockerProbe({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) })

  assert.equal(probe.available, false)
  assert.equal(probe.reason, 'unresponsive')
  assert.match(probe.detail, /did not respond/)
})

test('treats a stopped daemon (non-zero exit) as unavailable', () => {
  const probe = classifyDockerProbe({ status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' })

  assert.equal(probe.available, false)
  assert.equal(probe.reason, 'daemon-unreachable')
})

test('never throws on a malformed probe result', () => {
  const probe = classifyDockerProbe(undefined)

  assert.equal(probe.available, false)
  assert.equal(probe.reason, 'probe-failed')
})

test('keeps the probe timeout bounded', () => {
  assert.ok(Number.isFinite(DOCKER_PROBE_TIMEOUT_MS) && DOCKER_PROBE_TIMEOUT_MS > 0)
})

for (const runtimePath of ['../dev.mjs', '../../packages/create-app/template/scripts/dev.mjs']) {
  const runtimeSource = readFileSync(new URL(runtimePath, import.meta.url), 'utf8')
  const start = runtimeSource.indexOf('let dockerUnavailableNoticeShown = false')
  const end = runtimeSource.indexOf('async function checkOpencodeMcpWiring()', start)
  assert.ok(start >= 0 && end > start)
  const restartSource = runtimeSource.slice(start, end)

  function runRestart(probeResult) {
    const calls = []
    const warnings = []
    const activities = []
    const result = runInNewContext(`${restartSource}\n[restartOpencodeContainer('test'), restartOpencodeContainer('test')]`, {
      opencodeRestartAttempted: false,
      shuttingDown: false,
      DOCKER_PROBE_TIMEOUT_MS,
      classifyDockerProbe,
      console: { log() {}, warn: (message) => warnings.push(message) },
      updateSplashState: (state) => activities.push(state),
      opencodeRestartCommand: () => 'docker restart mercato-opencode',
      spawnSync: (command, args, options) => {
        calls.push({ command, args: Array.from(args), options })
        return args[0] === 'ps' ? probeResult : { status: 0 }
      },
    })
    return { result: Array.from(result), calls, warnings, activities }
  }

  for (const code of ['ENOENT', 'ETIMEDOUT']) {
    test(`${runtimePath} skips a ${code} Docker probe once and passes its timeout`, () => {
      const { result, calls, warnings, activities } = runRestart({ error: { code } })

      assert.deepEqual(result, [false, false])
      assert.equal(calls.length, 1)
      assert.equal(calls[0].command, 'docker')
      assert.deepEqual(calls[0].args, ['ps', '--format', '{{.Names}}'])
      assert.equal(calls[0].options.timeout, DOCKER_PROBE_TIMEOUT_MS)
      assert.equal(warnings.filter((message) => message.includes('Skipping')).length, 1)
      assert.equal(activities.length, 0)
    })
  }

  test(`${runtimePath} skips unrelated containers without warning`, () => {
    const { result, calls, warnings, activities } = runRestart({ status: 0, stdout: 'mercato-postgres\n' })

    assert.deepEqual(result, [false, false])
    assert.equal(calls.length, 1)
    assert.equal(warnings.length, 0)
    assert.equal(activities.length, 0)
  })

  test(`${runtimePath} still restarts the running OpenCode container once`, () => {
    const { result, calls, warnings, activities } = runRestart({ status: 0, stdout: 'mercato-opencode\n' })

    assert.deepEqual(result, [true, false])
    assert.equal(calls.length, 2)
    assert.equal(calls[1].command, 'docker')
    assert.deepEqual(calls[1].args, ['restart', 'mercato-opencode'])
    assert.equal(warnings.length, 0)
    assert.equal(activities.length, 1)
  })
}
