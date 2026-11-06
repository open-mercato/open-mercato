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
