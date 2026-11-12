import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { parseEnv } from 'node:util'

// Mirrors scripts/dev-env-file.mjs: .env.example ships no tenant encryption key
// (#7231), so a .env materialized from it gets a unique machine-local key once.
const GENERATED_SECRET_KEYS = ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY'] as const

export function fillEmptyEnvSecrets(
  content: string,
  randomSource: (size: number) => Buffer = randomBytes,
): string {
  const example = parseEnv(content)
  const keyNames = ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'TENANT_DATA_ENCRYPTION_KEY']
  const configured = keyNames.some((key) =>
    [process.env[key], example[key]].some((value) =>
      (value ?? '').trim().replace(/^['"]|['"]$/g, '').trim().length > 0))
  if (configured) return content
  let next = content
  for (const key of GENERATED_SECRET_KEYS) {
    const pattern = new RegExp(`^(${key}=)[ \\t]*(\\r?)$`, 'm')
    next = next.replace(pattern, (_match, prefix: string, lineEnd: string) =>
      `${prefix}${randomSource(32).toString('hex')}${lineEnd}`)
  }
  return next
}

export function createEnvFileFromExample(examplePath: string, envPath: string): void {
  const content = fs.readFileSync(examplePath, 'utf8')
  fs.writeFileSync(envPath, fillEmptyEnvSecrets(content), { flag: 'wx' })
}
