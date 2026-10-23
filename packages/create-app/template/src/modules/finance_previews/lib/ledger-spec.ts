import { z } from 'zod'
import chart from '../data/ledger-starter-chart.json'
import copy from '../data/ledger-spec-copy.json'

export const ledgerStorageKey = 'finance-preview-ledger-spec-v1'
const accountSchema = z.object({
  number: z.string(),
  name: z.string(),
  type: z.string(),
  normal: z.enum(['DEBIT', 'CREDIT']),
  used: z.boolean(),
})
const typeSchema = z.object({
  number: z.string(),
  name: z.string(),
  normal: z.enum(['DEBIT', 'CREDIT']),
})
const centerSchema = z.object({
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
})
const bankSchema = z.object({
  number: z.string(),
  primary: z.boolean(),
  status: z.enum(['UNKNOWN', 'WHITELISTED', 'NOT_WHITELISTED']),
  checked: z.string(),
})
const contractorSchema = z.object({
  id: z.string(),
  nip: z.string(),
  name: z.string(),
  address: z.string(),
  email: z.string(),
  phone: z.string(),
  vendor: z.boolean(),
  customer: z.boolean(),
  registry: z.enum(['PENDING', 'VERIFIED', 'FAILED']),
  approval: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reason: z.string(),
  banks: z.array(bankSchema),
  snapshot: z
    .object({
      name: z.string(),
      nip: z.string(),
      bank: z.string(),
      checked: z.string(),
    })
    .nullable(),
})
export const ledgerStateSchema = z.object({
  accounts: z.array(accountSchema),
  types: z.array(typeSchema),
  periods: z.array(
    z.object({ start: z.string(), end: z.string(), locked: z.boolean() }),
  ),
  centers: z.array(centerSchema),
  clearing: z.string(),
  unallocatedAccount: z.string(),
  rules: z.array(
    z.object({ source: z.string(), target: z.string(), center: z.string() }),
  ),
  reclassification: z
    .object({ target: z.string(), clearing: z.string(), center: z.string() })
    .nullable(),
  contractors: z.array(contractorSchema),
})
export type LedgerState = z.infer<typeof ledgerStateSchema>
export type Contractor = z.infer<typeof contractorSchema>
export type Account = z.infer<typeof accountSchema>
export const initialLedgerState: LedgerState = {
  accounts: [],
  types: [],
  periods: [],
  centers: copy.fixture.centers,
  clearing: '',
  unallocatedAccount: '',
  rules: [],
  reclassification: null,
  contractors: [],
}
export const starterChart = {
  accounts: chart.accounts.map((account) => accountSchema.parse(account)),
  types: chart.types.map((accountType) => typeSchema.parse(accountType)),
}
export const money = (cents: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(
    cents / 100,
  )
export const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value
export function generatePeriods(
  start: string,
  existing: LedgerState['periods'],
) {
  if (!isDate(start) || !start.endsWith('-01')) throw new Error(copy.firstDay)
  const initial = new Date(`${start}T00:00:00Z`)
  const periods = Array.from({ length: 12 }, (_, index) => ({
    start: new Date(
      Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth() + index, 1),
    )
      .toISOString()
      .slice(0, 10),
    end: new Date(
      Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth() + index + 1, 0),
    )
      .toISOString()
      .slice(0, 10),
    locked: false,
  }))
  if (
    periods.some((period) =>
      existing.some(
        (other) => period.start <= other.end && period.end >= other.start,
      ),
    )
  )
    throw new Error(copy.overlap)
  return [...existing, ...periods].sort((left, right) =>
    left.start.localeCompare(right.start),
  )
}
export function validNip(value: string) {
  if (!/^\d{10}$/.test(value)) return false
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  return (
    weights.reduce(
      (sum, weight, index) => sum + weight * Number(value[index]),
      0,
    ) %
      11 ===
    Number(value[9])
  )
}
export function validBank(value: string) {
  if (!/^PL\d{26}$/.test(value)) return false
  const rearranged = `${value.slice(4)}2521${value.slice(2, 4)}`
  let remainder = 0
  for (const digit of rearranged)
    remainder = (remainder * 10 + Number(digit)) % 97
  return remainder === 1
}
export function reconcile(state: LedgerState): LedgerState {
  if (state.reclassification) return state
  if (!state.clearing || !state.unallocatedAccount)
    throw new Error(copy.unconfigured)
  if (
    !state.periods.some(
      (period) =>
        period.start <= '2026-09-25' &&
        period.end >= '2026-09-25' &&
        !period.locked,
    )
  )
    throw new Error(copy.needsPeriod)
  const rule = state.rules.find((candidate) => candidate.source === '402-1')
  const center = state.centers.find(
    (candidate) => candidate.code === rule?.center && candidate.active,
  )
  return {
    ...state,
    reclassification: {
      target: rule?.target ?? state.unallocatedAccount,
      clearing: state.clearing,
      center: center?.code ?? 'UNALLOCATED',
    },
  }
}
export function journalEntries(state: LedgerState) {
  const entries = [...copy.fixture.entries]
  if (state.reclassification)
    entries.push({
      id: 'PK/2026/4-5',
      date: '2026-09-25',
      description: copy.reclassDescription,
      type: 'NORMAL',
      reference: 'FZ/2026/091',
      lines: [
        { account: state.reclassification.target, debit: 123000, credit: 0 },
        { account: state.reclassification.clearing, debit: 0, credit: 123000 },
      ],
    })
  return entries
}
export function trialBalance(state: LedgerState, start: string, end: string) {
  const entries = journalEntries(state)
  return state.accounts.map((account) => {
    let opening = 0
    let periodDebit = 0
    let periodCredit = 0
    let ytdDebit = 0
    let ytdCredit = 0
    for (const entry of entries) {
      if (entry.date > end) continue
      for (const line of entry.lines.filter(
        (candidate) => candidate.account === account.number,
      )) {
        if (entry.date < start) opening += line.debit - line.credit
        else {
          periodDebit += line.debit
          periodCredit += line.credit
        }
        if (entry.date >= `${start.slice(0, 4)}-01-01`) {
          ytdDebit += line.debit
          ytdCredit += line.credit
        }
      }
    }
    const sign = account.normal === 'DEBIT' ? 1 : -1
    return {
      ...account,
      opening: opening === 0 ? 0 : opening * sign,
      periodDebit,
      periodCredit,
      ytdDebit,
      ytdCredit,
      closing: opening + periodDebit - periodCredit === 0 ? 0 : (opening + periodDebit - periodCredit) * sign,
    }
  })
}
