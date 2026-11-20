import { QUOTE_SEND_CC_LIMIT, quoteSendCcAddressSchema } from '../data/validators'

export type PendingCcResult =
  | { ok: true; cc: string[] }
  | { ok: false; reason: 'invalid' | 'limit' }

export function isQuoteCcAddress(value: string): boolean {
  return quoteSendCcAddressSchema.safeParse(value).success
}

/** Resolves the CC list to send, including an address typed but not confirmed as a tag. */
export function commitPendingCc(current: string[], pending: string): PendingCcResult {
  const address = pending.trim()
  if (!address) return { ok: true, cc: current }
  if (!isQuoteCcAddress(address)) return { ok: false, reason: 'invalid' }
  if (current.includes(address)) return { ok: true, cc: current }
  if (current.length >= QUOTE_SEND_CC_LIMIT) return { ok: false, reason: 'limit' }
  return { ok: true, cc: [...current, address] }
}
