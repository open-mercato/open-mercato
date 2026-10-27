import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MCP_DEFAULT_PORT,
  buildManagedMcpAppEnv,
  buildMcpCliArgs,
  deriveMcpHealthUrl,
  isFastMcpCrash,
  isManagedMcpReadiness,
  isKeyRotationOutput,
  looksLikeMissingAiAssistantModule,
  looksLikeMcpPortCollision,
  looksLikeMcpServerListening,
  looksLikeMissingKeyOwner,
  looksLikePermissionError,
  looksLikeUninitializedDatabase,
  nextMcpKeyRetryDelayMs,
  nextMcpRestartDelayMs,
  resolveMcpKeyFilePath,
  resolveMcpPort,
  selectAvailableMcpPort,
  shouldRetryMcpProvisioning,
  shouldStartMcp,
} from '../dev-mcp.mjs'

test('shouldStartMcp defaults to on', () => {
  assert.equal(shouldStartMcp({ args: [], env: {} }), true)
})

test('shouldStartMcp is disabled for app-only runs regardless of flags', () => {
  assert.equal(shouldStartMcp({ args: ['--with-mcp'], env: {}, appOnly: true }), false)
})

test('shouldStartMcp honors --no-mcp over env and default', () => {
  assert.equal(shouldStartMcp({ args: ['--no-mcp'], env: { OM_DEV_WITH_MCP: '1' } }), false)
})

test('shouldStartMcp lets --with-mcp win over a disabling env', () => {
  assert.equal(shouldStartMcp({ args: ['--with-mcp'], env: { OM_DEV_WITH_MCP: '0' } }), true)
})

test('shouldStartMcp reads OM_DEV_WITH_MCP tokens', () => {
  for (const token of ['0', 'false', 'no', 'off', ' OFF ']) {
    assert.equal(shouldStartMcp({ args: [], env: { OM_DEV_WITH_MCP: token } }), false, token)
  }
  for (const token of ['1', 'true', 'yes', 'on']) {
    assert.equal(shouldStartMcp({ args: [], env: { OM_DEV_WITH_MCP: token } }), true, token)
  }
})

test('shouldStartMcp falls back to on for unrecognized env tokens', () => {
  assert.equal(shouldStartMcp({ args: [], env: { OM_DEV_WITH_MCP: 'banana' } }), true)
})

test('resolveMcpPort parses MCP_PORT and rejects invalid values', () => {
  assert.equal(resolveMcpPort({}), MCP_DEFAULT_PORT)
  assert.equal(resolveMcpPort({ MCP_PORT: '4123' }), 4123)
  assert.equal(resolveMcpPort({ MCP_PORT: 'nope' }), MCP_DEFAULT_PORT)
  assert.equal(resolveMcpPort({ MCP_PORT: '0' }), MCP_DEFAULT_PORT)
  assert.equal(resolveMcpPort({ MCP_PORT: '70000' }), MCP_DEFAULT_PORT)
})

test('selectAvailableMcpPort preserves a free preference and falls back when occupied', async () => {
  const preferred = await selectAvailableMcpPort(0)
  assert.equal(await selectAvailableMcpPort(preferred), preferred)

  const occupied = createServer()
  await new Promise((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen({ port: preferred, host: '127.0.0.1', exclusive: true }, resolve)
  })
  try {
    const fallback = await selectAvailableMcpPort(preferred)
    assert.notEqual(fallback, preferred)
    assert.ok(fallback > 0 && fallback <= 65535)
  } finally {
    await new Promise((resolve) => occupied.close(resolve))
  }
})

test('resolveMcpKeyFilePath defaults under .mercato/mcp-shared and honors the env override', () => {
  const cwd = path.join(path.sep, 'srv', 'repo')
  assert.equal(
    resolveMcpKeyFilePath({}, cwd),
    path.join(cwd, '.mercato', 'mcp-shared', 'mcp-api-key'),
  )
  assert.equal(
    resolveMcpKeyFilePath({ MCP_SERVER_API_KEY_FILE: 'custom/key' }, cwd),
    path.resolve(cwd, 'custom/key'),
  )
  const absolute = path.join(path.sep, 'run', 'mcp', 'key')
  assert.equal(resolveMcpKeyFilePath({ MCP_SERVER_API_KEY_FILE: absolute }, cwd), absolute)
})

test('nextMcpRestartDelayMs backs off exponentially and caps at 60s', () => {
  assert.equal(nextMcpRestartDelayMs(0), 5_000)
  assert.equal(nextMcpRestartDelayMs(1), 10_000)
  assert.equal(nextMcpRestartDelayMs(2), 20_000)
  assert.equal(nextMcpRestartDelayMs(10), 60_000)
  assert.equal(nextMcpRestartDelayMs(-3), 5_000)
})

test('nextMcpKeyRetryDelayMs backs off 30s → 60s → 120s cap', () => {
  assert.equal(nextMcpKeyRetryDelayMs(0), 30_000)
  assert.equal(nextMcpKeyRetryDelayMs(1), 60_000)
  assert.equal(nextMcpKeyRetryDelayMs(2), 120_000)
  assert.equal(nextMcpKeyRetryDelayMs(9), 120_000)
})

test('isFastMcpCrash classifies by uptime', () => {
  assert.equal(isFastMcpCrash(1_000), true)
  assert.equal(isFastMcpCrash(59_999), true)
  assert.equal(isFastMcpCrash(60_000), false)
  assert.equal(isFastMcpCrash(-1), false)
})

test('buildMcpCliArgs routes through the app workspace in monorepo mode', () => {
  assert.deepEqual(
    buildMcpCliArgs(['mcp:serve-http', '--port', '3001'], { isMonorepo: true }),
    ['workspace', '@open-mercato/app', 'mercato', 'ai_assistant', 'mcp:serve-http', '--port', '3001'],
  )
  assert.deepEqual(
    buildMcpCliArgs(['mcp:ensure-api-key', '--file', 'x'], { isMonorepo: false }),
    ['mercato', 'ai_assistant', 'mcp:ensure-api-key', '--file', 'x'],
  )
})

test('deriveMcpHealthUrl points at localhost health endpoint', () => {
  assert.equal(deriveMcpHealthUrl(3001), 'http://localhost:3001/health')
})

test('buildManagedMcpAppEnv propagates the selected port without replacing explicit external configuration', () => {
  assert.deepEqual(buildManagedMcpAppEnv({
    enabled: true,
    port: 3123,
    keyFilePath: '/repo/.mercato/mcp-api-key',
    env: {},
  }), {
    MCP_SERVER_API_KEY_FILE: '/repo/.mercato/mcp-api-key',
    MCP_URL: 'http://localhost:3123',
  })
  assert.deepEqual(buildManagedMcpAppEnv({
    enabled: true,
    port: 3123,
    keyFilePath: '/repo/.mercato/mcp-api-key',
    env: {
      MCP_SERVER_API_KEY: 'external-key',
      MCP_URL: 'https://external.example/mcp',
    },
  }), {})
  assert.deepEqual(buildManagedMcpAppEnv({ enabled: false, port: 3123, keyFilePath: '/tmp/key', env: {} }), {})
})

test('isManagedMcpReadiness rejects stale probes and accepts only the current listening child', () => {
  const ready = {
    childListening: true,
    childExitCode: null,
    childSignalCode: null,
    attemptedPort: 3123,
    currentPort: 3123,
    responseOk: true,
  }
  assert.equal(isManagedMcpReadiness(ready), true)
  assert.equal(isManagedMcpReadiness({ ...ready, childListening: false }), false)
  assert.equal(isManagedMcpReadiness({ ...ready, childExitCode: 1 }), false)
  assert.equal(isManagedMcpReadiness({ ...ready, attemptedPort: 3001 }), false)
  assert.equal(isManagedMcpReadiness({ ...ready, responseOk: false }), false)
})

test('MCP lifecycle output classifiers distinguish bind collisions and child readiness', () => {
  assert.equal(looksLikeMcpPortCollision(['Error: listen EADDRINUSE: address already in use :::3001']), true)
  assert.equal(looksLikeMcpPortCollision(['connect ECONNREFUSED 127.0.0.1:3001']), false)
  assert.equal(looksLikeMcpServerListening(['{"msg":"Server listening","port":3002}']), true)
  assert.equal(looksLikeMcpServerListening(['Endpoint ready http://localhost:3002/mcp']), false)
})

test('output classifiers detect rotation, permission, and uninitialized-database lines', () => {
  assert.equal(isKeyRotationOutput(['[mcp:ensure-api-key] New key created (id=1, prefix=omk_)']), true)
  assert.equal(isKeyRotationOutput(['[mcp:ensure-api-key] Existing key is valid (id=1, prefix=omk_)']), false)
  assert.equal(looksLikePermissionError(['EACCES: permission denied, open /repo/.mercato/mcp-shared/mcp-api-key']), true)
  assert.equal(looksLikePermissionError(['some other failure']), false)
  assert.equal(looksLikeUninitializedDatabase(['error: relation "api_keys" does not exist']), true)
  assert.equal(looksLikeUninitializedDatabase(['connect ECONNREFUSED 127.0.0.1:5432']), true)
  assert.equal(looksLikeUninitializedDatabase(['TypeError: boom']), false)
})

test('looksLikeMissingKeyOwner detects the owner-not-found throw', () => {
  assert.equal(
    looksLikeMissingKeyOwner(['[internal] MCP API key owner not found: no active user with email "superadmin@acme.com".']),
    true,
  )
  assert.equal(looksLikeMissingKeyOwner(['Run "mercato init" first or pass --email pointing at an existing admin user.']), true)
  // "Run mercato init" is an owner-resolution failure, not a bare DB-not-ready signal.
  assert.equal(looksLikeUninitializedDatabase(['Run "mercato init" first']), false)
  assert.equal(looksLikeMissingKeyOwner(['connect ECONNREFUSED 127.0.0.1:5432']), false)
})

test('looksLikeMissingAiAssistantModule matches the CLI missing-module output only', () => {
  assert.equal(looksLikeMissingAiAssistantModule(['❌ Module not found: "ai_assistant"']), true)
  assert.equal(looksLikeMissingAiAssistantModule(['Module not found: "customers"']), false)
  assert.equal(looksLikeMissingAiAssistantModule(['Module not found: "ai_assistant_x"']), false)
  assert.equal(looksLikeMissingAiAssistantModule(['Module not found: "ai_assistants"']), false)
  assert.equal(looksLikeMissingAiAssistantModule(["Error: Cannot find module 'x' code: 'MODULE_NOT_FOUND'"]), false)
  assert.equal(looksLikeMissingAiAssistantModule(['connect ECONNREFUSED 127.0.0.1:5432']), false)
})

test('shouldRetryMcpProvisioning stops for a missing ai_assistant module and keeps retrying transient failures', () => {
  assert.equal(shouldRetryMcpProvisioning(['❌ Module not found: "ai_assistant"']), false)
  assert.equal(shouldRetryMcpProvisioning(['connect ECONNREFUSED 127.0.0.1:5432']), true)
  assert.equal(shouldRetryMcpProvisioning(['error: relation "api_keys" does not exist']), true)
  assert.equal(shouldRetryMcpProvisioning([]), true)
})

test('dev runner returns without retrying when ai_assistant is missing, in root and template copies', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const file of [
    path.resolve(here, '..', 'dev.mjs'),
    path.resolve(here, '..', '..', 'packages', 'create-app', 'template', 'scripts', 'dev.mjs'),
  ]) {
    const source = readFileSync(file, 'utf8')
    const guard = source.indexOf('if (!shouldRetryMcpProvisioning(capturedLines))')
    const retry = source.indexOf('nextMcpKeyRetryDelayMs(attempt)')
    assert.ok(guard > 0 && guard < retry, file)
    assert.match(source.slice(guard, retry), /return false/, file)
  }
})
