import { createHash, timingSafeEqual } from 'node:crypto'

export type TpayMd5Input = {
  id: string
  trId: string
  trAmount: string
  trCrc: string
  securityCode: string
}

export function computeTpayMd5(input: TpayMd5Input): string {
  return createHash('md5')
    .update(`${input.id}${input.trId}${input.trAmount}${input.trCrc}${input.securityCode}`, 'utf8')
    .digest('hex')
}

export function verifyTpayMd5(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected.toLowerCase(), 'utf8')
  const actualBuffer = Buffer.from(actual.toLowerCase(), 'utf8')
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}
