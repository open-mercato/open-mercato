import { randomBytes } from 'node:crypto'
import fs from 'node:fs'

// Mirrors scripts/dev-env-file.mjs: .env.example ships no tenant encryption key
// (#7231), so a .env materialized from it gets a unique machine-local key once.
const GENERATED_SECRET_KEYS = ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY'] as const

export function fillEmptyEnvSecrets(
  content: string,
  randomSource: (size: number) => Buffer = randomBytes,
): string {
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
