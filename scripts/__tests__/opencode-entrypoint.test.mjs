import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const entrypointPath = path.join(repoRoot, 'docker/opencode/entrypoint.sh')

function runEntrypoint(env = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-entrypoint-'))
  const binDir = path.join(tempDir, 'bin')
  const configDir = path.join(tempDir, 'config')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'opencode'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

  const result = spawnSync('bash', [entrypointPath], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      OPENCODE_CONFIG_DIR: configDir,
      OPENROUTER_BASE_URL: '',
      ...env,
    },
    encoding: 'utf8',
  })

  const configPath = path.join(configDir, 'opencode.jsonc')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  fs.rmSync(tempDir, { recursive: true, force: true })

  return { config, result }
}

test('opencode entrypoint writes OpenRouter baseURL option when configured', () => {
  const { config, result } = runEntrypoint({
    OM_AI_PROVIDER: 'openrouter',
    OM_AI_MODEL: 'meta-llama/llama-3.3-70b-instruct',
    OPENROUTER_BASE_URL: 'https://openrouter-proxy.example.com/v1',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(config.model, 'openrouter/meta-llama/llama-3.3-70b-instruct')
  assert.deepEqual(config.provider.openrouter.models, {
    'meta-llama/llama-3.3-70b-instruct': {},
  })
  assert.equal(config.provider.openrouter.options.baseURL, 'https://openrouter-proxy.example.com/v1')
})

test('opencode entrypoint omits OpenRouter baseURL option when unset', () => {
  const { config, result } = runEntrypoint({
    OM_AI_PROVIDER: 'openrouter',
    OM_AI_MODEL: 'openrouter/meta-llama/llama-3.3-70b-instruct',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(config.model, 'openrouter/meta-llama/llama-3.3-70b-instruct')
  assert.deepEqual(config.provider.openrouter.models, {
    'meta-llama/llama-3.3-70b-instruct': {},
  })
  assert.equal(config.provider.openrouter.options, undefined)
})
