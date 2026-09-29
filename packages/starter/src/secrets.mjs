import crypto from 'node:crypto'

export function secretHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

export function secretFingerprint(value) {
  if (!value) return 'empty'
  const digest = crypto.createHash('sha256').update(value).digest('hex')
  return `sha256:${digest.slice(0, 12)}`
}
