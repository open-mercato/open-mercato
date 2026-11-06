import { randomBytes } from 'node:crypto'
import fs from 'node:fs'

// .env.example ships no tenant encryption key (#7231). A .env materialized from
// it gets a unique machine-local key once, so fresh installs encrypt tenant data
// instead of silently storing it as plaintext. Existing .env files are never touched.
const GENERATED_SECRET_KEYS = ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY']

export function fillEmptyEnvSecrets(content, randomSource = randomBytes) {
  let next = content
  for (const key of GENERATED_SECRET_KEYS) {
    const pattern = new RegExp(`^(${key}=)[ \\t]*(\\r?)$`, 'm')
    next = next.replace(pattern, (_match, prefix, lineEnd) => `${prefix}${randomSource(32).toString('hex')}${lineEnd}`)
  }
  return next
}

export function createEnvFileFromExample(examplePath, envPath, randomSource = randomBytes) {
  const content = fs.readFileSync(examplePath, 'utf8')
  fs.writeFileSync(envPath, fillEmptyEnvSecrets(content, randomSource), { flag: 'wx' })
}
