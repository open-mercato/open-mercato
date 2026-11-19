import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEnvFileFromExample, fillEmptyEnvSecrets } from '../env-example'

const fixedRandom = (size: number) => Buffer.alloc(size, 0xcd)

describe('env-example', () => {
  it('generates an empty tenant encryption key without touching other lines', () => {
    const content = 'JWT_SECRET=change-me\r\nTENANT_DATA_ENCRYPTION_FALLBACK_KEY=\r\nTENANT_DATA_ENCRYPTION_KEY=\r\n'
    expect(fillEmptyEnvSecrets(content, fixedRandom)).toBe(
      `JWT_SECRET=change-me\r\nTENANT_DATA_ENCRYPTION_FALLBACK_KEY=${'cd'.repeat(32)}\r\nTENANT_DATA_ENCRYPTION_KEY=\r\n`,
    )
  })

  it('keeps a supplied key', () => {
    const content = 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=operator-key\n'
    expect(fillEmptyEnvSecrets(content, fixedRandom)).toBe(content)
  })

  it('creates .env with a fresh key and refuses to overwrite an existing file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cli-env-example-'))
    try {
      const examplePath = path.join(directory, '.env.example')
      const envPath = path.join(directory, '.env')
      fs.writeFileSync(examplePath, 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=\n')
      createEnvFileFromExample(examplePath, envPath)
      expect(fs.readFileSync(envPath, 'utf8')).toMatch(/^TENANT_DATA_ENCRYPTION_FALLBACK_KEY=[0-9a-f]{64}$/m)
      expect(() => createEnvFileFromExample(examplePath, envPath)).toThrow()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('operator key selection', () => {
  it.each(['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'TENANT_DATA_ENCRYPTION_KEY'])('preserves %s from either source', (key) => {
    const blank = 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=\nTENANT_DATA_ENCRYPTION_KEY=\n'
    const supplied = blank.replace(`${key}=\n`, `${key}="operator-selected-root"\n`)
    const unexpectedRandom = () => { throw new Error('must preserve selected root') }
    expect(fillEmptyEnvSecrets(supplied, unexpectedRandom)).toBe(supplied)
    const previous = process.env[key]
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cli-legacy-env-'))
    try {
      process.env[key] = 'operator-selected-root'
      expect(fillEmptyEnvSecrets(blank, unexpectedRandom)).toBe(blank)
      const examplePath = path.join(directory, '.env.example')
      const envPath = path.join(directory, '.env')
      fs.writeFileSync(examplePath, blank)
      createEnvFileFromExample(examplePath, envPath)
      expect(fs.readFileSync(envPath, 'utf8')).toBe(blank)
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
