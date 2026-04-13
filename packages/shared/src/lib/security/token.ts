import { createHash } from 'node:crypto'

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
