import { randomBytes } from 'node:crypto'

// Secrets `.env.example` ships as placeholders (or empty). `yarn setup` fills
// them with machine-local random values when it creates `.env`, mirroring the
// monorepo starter, so a fresh app never signs tokens with a published value.
const GENERATED_SECRETS = [
  ['JWT_SECRET', 32],
  ['AUTH_SECRET', 32],
  ['LOOKUP_HASH_PEPPER', 16],
]

export function fillGeneratedSecrets(envText, generate = (bytes) => randomBytes(bytes).toString('hex')) {
  let text = envText
  for (const [key, bytes] of GENERATED_SECRETS) {
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    if (pattern.test(text)) text = text.replace(pattern, `${key}=${generate(bytes)}`)
  }
  return text
}
