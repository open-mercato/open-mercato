import crypto from 'node:crypto'

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export function tokenHashEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
