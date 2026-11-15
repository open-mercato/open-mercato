import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createEnvFileFromExample, fillEmptyEnvSecrets } from '../dev-env-file.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixedRandom = (size) => Buffer.alloc(size, 0xab)

test('fillEmptyEnvSecrets generates an empty tenant encryption key and keeps other lines', () => {
  const content = 'JWT_SECRET=change-me\nTENANT_DATA_ENCRYPTION_FALLBACK_KEY=\nTENANT_DATA_ENCRYPTION_KEY=\n'
  assert.equal(fillEmptyEnvSecrets(content, fixedRandom),
    `JWT_SECRET=change-me\nTENANT_DATA_ENCRYPTION_FALLBACK_KEY=${'ab'.repeat(32)}\nTENANT_DATA_ENCRYPTION_KEY=\n`)
})

test('fillEmptyEnvSecrets preserves CRLF line endings and never replaces a supplied key', () => {
  assert.equal(fillEmptyEnvSecrets('TENANT_DATA_ENCRYPTION_FALLBACK_KEY=\r\nA=1\r\n', fixedRandom),
    `TENANT_DATA_ENCRYPTION_FALLBACK_KEY=${'ab'.repeat(32)}\r\nA=1\r\n`)
  const supplied = 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=operator-key\n# TENANT_DATA_ENCRYPTION_FALLBACK_KEY=\n'
  assert.equal(fillEmptyEnvSecrets(supplied, fixedRandom), supplied)
})

test('createEnvFileFromExample gives every shipped example a unique key and never overwrites .env', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-env-file-'))
  try {
    for (const example of ['apps/mercato/.env.example', 'packages/create-app/template/.env.example']) {
      const keys = ['a', 'b'].map((name) => {
        const envPath = path.join(directory, `${name}.env`)
        fs.rmSync(envPath, { force: true })
        createEnvFileFromExample(path.join(root, example), envPath)
        return fs.readFileSync(envPath, 'utf8').match(/^TENANT_DATA_ENCRYPTION_FALLBACK_KEY=([0-9a-f]{64})$/m)?.[1]
      })
      assert.ok(keys[0], `${example} must produce a generated key`)
      assert.notEqual(keys[0], keys[1])
    }
    const existing = path.join(directory, 'existing.env')
    fs.writeFileSync(existing, 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=kept\n')
    assert.throws(() => createEnvFileFromExample(path.join(root, 'apps/mercato/.env.example'), existing), { code: 'EEXIST' })
    assert.equal(fs.readFileSync(existing, 'utf8'), 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=kept\n')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

for (const helperPath of ['../dev-env-file.mjs', '../../packages/create-app/template/scripts/dev-env-file.mjs', '../../packages/cli/src/lib/env-example.ts']) {
  test(`${helperPath} preserves operator keys from examples and environment`, async () => {
    const helper = await import(helperPath)
    const blank = 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=\nTENANT_DATA_ENCRYPTION_KEY=\n'
    const unexpectedRandom = () => { throw new Error('must preserve selected root') }
    for (const key of ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'TENANT_DATA_ENCRYPTION_KEY']) {
      const supplied = blank.replace(`${key}=\n`, `${key}="operator-selected-root"\n`)
      assert.equal(helper.fillEmptyEnvSecrets(supplied, unexpectedRandom), supplied)
      const previous = process.env[key]
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-legacy-env-'))
      try {
        process.env[key] = 'operator-selected-root'
        assert.equal(helper.fillEmptyEnvSecrets(blank, unexpectedRandom), blank)
        const examplePath = path.join(directory, '.env.example')
        const envPath = path.join(directory, '.env')
        fs.writeFileSync(examplePath, blank)
        helper.createEnvFileFromExample(examplePath, envPath, unexpectedRandom)
        assert.equal(fs.readFileSync(envPath, 'utf8'), blank)
      } finally {
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }
  })
}

test('standalone setup combines existing auth secret generation with safe encryption key selection', async () => {
  const { fillGeneratedSecrets } = await import('../../packages/create-app/template/scripts/dev-env-secrets.mjs')
  const { fillEmptyEnvSecrets: fillTemplate } = await import('../../packages/create-app/template/scripts/dev-env-file.mjs')
  const content = 'JWT_SECRET=placeholder\nAUTH_SECRET=placeholder\nLOOKUP_HASH_PEPPER=\nTENANT_DATA_ENCRYPTION_FALLBACK_KEY=\nTENANT_DATA_ENCRYPTION_KEY=operator-selected-root\n'
  const actual = fillTemplate(fillGeneratedSecrets(content, () => 'generated-auth-secret'), () => { throw new Error('must preserve selected root') })
  assert.match(actual, /^JWT_SECRET=generated-auth-secret$/m)
  assert.match(actual, /^TENANT_DATA_ENCRYPTION_FALLBACK_KEY=$/m)
  assert.match(actual, /^TENANT_DATA_ENCRYPTION_KEY=operator-selected-root$/m)
  const setup = fs.readFileSync(path.join(root, 'packages/create-app/template/scripts/setup.mjs'), 'utf8')
  assert.match(setup, /fillEmptyEnvSecrets\(fillGeneratedSecrets\(/)
  assert.match(setup, /acquireDevSessionWithRecovery/)
})
