import { tpayHttpError } from './errors'

export async function toTpayAmount(amount: number): Promise<number> {
  const grosze = toGrosze(amount)
  if (grosze === null) throw await tpayHttpError(422, 'invalidAmount')
  return grosze / 100
}

export function toGrosze(amount: number): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  const normalized = amount.toPrecision(15)
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized)
  if (!match) return null
  const fraction = (match[2] ?? '').padEnd(3, '0')
  const whole = Number(match[1])
  const cents = Number(fraction.slice(0, 2))
  const roundUp = Number(fraction[2]) >= 5 ? 1 : 0
  const grosze = whole * 100 + cents + roundUp
  if (!Number.isSafeInteger(grosze) || grosze <= 0) return null
  return grosze
}
