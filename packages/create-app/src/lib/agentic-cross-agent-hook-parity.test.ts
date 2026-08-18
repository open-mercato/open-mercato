/**
 * Cross-agent parity for the gate-evidence hook.
 *
 * `agentic-claude-hook-parity.test.ts` covers the Claude target. These assert the same
 * guarantees for Cursor and Codex, and that the three implementations agree on the decisions
 * that matter — the repo duplicates hooks per agent rather than sharing a core, so nothing
 * else stops them drifting apart.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as claude from '../../agentic/claude-code/hooks/gate-evidence.ts'
import * as cursor from '../../agentic/cursor/hooks/gate-evidence.mjs'
import * as codex from '../../agentic/codex/hooks/gate-evidence.mjs'

const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))
const PORTS = [['cursor', cursor], ['codex', codex]] as const

const SHIPPING_HOOKS = ['claude-code', 'cursor', 'codex'] as const

for (const agent of SHIPPING_HOOKS) {
  test(`${agent}: ships a gate-evidence hook`, () => {
    // The rules are cross-agent (installed via generateShared); the enforcement should be too.
    const dir = path.join(agenticRoot, agent, 'hooks')
    const hooks = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    assert.ok(
      hooks.some((name) => name.startsWith('gate-evidence.')),
      `${agent} ships hooks but no gate-evidence — gate enforcement would be agent-specific`,
    )
  })

  test(`${agent}: every hook its config registers exists on disk`, () => {
    const configName = agent === 'claude-code'
      ? 'settings.experimental-hooks-validator.json'
      : agent === 'cursor'
        ? 'hooks.experimental-hooks-validator.json'
        : 'hooks.json'
    const configPath = path.join(agenticRoot, agent, configName)
    assert.ok(fs.existsSync(configPath), `${agent} ships hooks but no ${configName} to register them`)
    const config = fs.readFileSync(configPath, 'utf8')
    const referenced = [...config.matchAll(/hooks\/([A-Za-z0-9._-]+\.(?:ts|mjs))/g)].map((m) => m[1])
    assert.ok(referenced.length > 0, `${agent}/${configName} registers no hook files`)
    for (const name of new Set(referenced)) {
      assert.ok(
        fs.existsSync(path.join(agenticRoot, agent, 'hooks', name)),
        `${agent}/${configName} registers hooks/${name}, which does not exist — every tool call would error`,
      )
    }
  })

  test(`${agent}: the wizard keeps every shipped hook available behind setup policy`, () => {
    const wizard = fs.readFileSync(
      fileURLToPath(new URL(`../setup/tools/${agent}.ts`, import.meta.url)),
      'utf8',
    )
    for (const hook of fs.readdirSync(path.join(agenticRoot, agent, 'hooks'))) {
      assert.ok(wizard.includes(`hooks/${hook}`) || /copyHooksDir|hooks'\)/.test(wizard),
        `the wizard cannot install ${agent}/hooks/${hook}`)
    }
  })
}

test('default tool configs do not register the experimental gate-evidence validator', () => {
  for (const [agent, configName] of [
    ['claude-code', 'settings.json'],
    ['cursor', 'hooks.json'],
  ] as const) {
    const config = fs.readFileSync(path.join(agenticRoot, agent, configName), 'utf8')
    assert.doesNotMatch(config, /gate-evidence/)
  }
})

for (const [name, hook] of PORTS) {
  test(`${name}: matchGates agrees with claude-code`, () => {
    for (const command of [
      'yarn typecheck',
      'npx tsc --noEmit',
      'yarn generate && yarn typecheck && yarn lint && yarn test && yarn build',
      'git status --short',
      'git commit -m "run tsc --noEmit"',
    ]) {
      assert.deepEqual(
        [...hook.matchGates(command)].sort(),
        [...claude.matchGates(command)].sort(),
        command,
      )
    }
  })

  test(`${name}: isAttributableGateCommand agrees with claude-code`, () => {
    for (const command of ['yarn typecheck', 'yarn typecheck | tail -30', 'yarn typecheck; yarn lint', 'yarn a && yarn b']) {
      assert.equal(hook.isAttributableGateCommand(command), claude.isAttributableGateCommand(command), command)
    }
  })

  test(`${name}: shouldBlock agrees with claude-code across the decision table`, () => {
    const cases = [
      { newestSrcMtimeMs: 2_000, sessionStartedAtMs: 1_000, lastGreenTypecheckMs: null },
      { newestSrcMtimeMs: 3_000, sessionStartedAtMs: 1_000, lastGreenTypecheckMs: 2_000 },
      { newestSrcMtimeMs: 2_000, sessionStartedAtMs: 1_000, lastGreenTypecheckMs: 3_000 },
      { newestSrcMtimeMs: 500, sessionStartedAtMs: 1_000, lastGreenTypecheckMs: null },
      { newestSrcMtimeMs: null, sessionStartedAtMs: 1_000, lastGreenTypecheckMs: null },
    ]
    for (const input of cases) {
      assert.equal(hook.shouldBlock(input), claude.shouldBlock(input), JSON.stringify(input))
    }
  })

  test(`${name}: nextSessionState agrees with claude-code`, () => {
    const at = '2026-08-14T09:00:00Z'
    assert.deepEqual(hook.nextSessionState({}, 'a', at), claude.nextSessionState({}, 'a', at))
    const prior = { sessionId: 'a', sessionStartedAt: at, gates: { typecheck: { exitCode: 0, finishedAt: at } } }
    assert.deepEqual(hook.nextSessionState(prior, 'b', at), claude.nextSessionState(prior, 'b', at))
  })

  test(`${name}: inferExitCode never reads absent or failing output as a pass`, () => {
    // These hosts report no exit code, so a loose inference would manufacture the false green
    // the hook exists to prevent.
    assert.equal(hook.inferExitCode(''), 1, 'no output is not evidence of success')
    assert.equal(hook.inferExitCode('src/a.ts(1,1): error TS2307: Cannot find module'), 1)
    assert.equal(hook.inferExitCode('FATAL ERROR: heap out of memory'), 1)
    assert.equal(hook.inferExitCode('No tests found, exiting with code 0'), 1)
    assert.equal(hook.inferExitCode('Tasks: 22 successful, 22 total'), 0)
  })
}

test('codex: readToolResponseText unwraps the documented response shapes', () => {
  assert.equal(codex.readToolResponseText({ tool_response: 'raw' }), 'raw')
  assert.equal(codex.readToolResponseText({ tool_response: { output: 'out' } }), 'out')
  assert.equal(codex.readToolResponseText({ tool_response: { stdout: 'so' } }), 'so')
  assert.equal(codex.readToolResponseText({}), '')
})
