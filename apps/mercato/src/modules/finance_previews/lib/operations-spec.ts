import { z } from 'zod'

export const money = (amount: number, currency = 'PLN') =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(amount)

export const rounded = (amount: number) =>
  Math.round((amount + Number.EPSILON) * 100) / 100

export const numeric = (value: unknown) =>
  typeof value === 'number'
    ? value
    : Number(
        String(value ?? '')
          .replace(/\s/g, '')
          .replace(',', '.'),
      )

export const valueSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)
export type FormValues = z.infer<typeof valueSchema>

export const journalSchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  account: z.string(),
  debit: z.number(),
  credit: z.number(),
})
export type JournalLine = z.infer<typeof journalSchema>

export const scheduleRowSchema = z.object({
  id: z.string(),
  start: z.string(),
  end: z.string(),
  amount: z.number(),
  accrued: z.boolean(),
  journal: z.string().nullable(),
})
export type ScheduleRow = z.infer<typeof scheduleRowSchema>

export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last)))
    .toISOString()
    .slice(0, 10)
}

export function dayBefore(date: string) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10)
}

export function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}

export function monthlySchedule(
  amount: number,
  start: string,
  months: number,
  finalDate?: string,
): ScheduleRow[] {
  const cents = Math.round(amount * 100)
  const regularCents = Math.floor(cents / months)
  return Array.from({ length: months }, (_, index) => ({
    id: String(index + 1),
    start: addMonths(start, index),
    end:
      index === months - 1 && finalDate
        ? finalDate
        : dayBefore(addMonths(start, index + 1)),
    amount:
      (index === months - 1
        ? cents - regularCents * (months - 1)
        : regularCents) / 100,
    accrued: false,
    journal: null,
  }))
}

export function serviceSchedule(
  amount: number,
  start: string,
  end: string,
): ScheduleRow[] {
  let months = 1
  while (addMonths(start, months) < end && months < 120) months += 1
  return monthlySchedule(amount, start, months, end)
}

export function balancedEntry(
  id: string,
  date: string,
  description: string,
  debitAccount: string,
  creditAccount: string,
  amount: number,
): JournalLine[] {
  return [
    {
      id: `${id}-d`,
      date,
      description,
      account: debitAccount,
      debit: rounded(amount),
      credit: 0,
    },
    {
      id: `${id}-c`,
      date,
      description,
      account: creditAccount,
      debit: 0,
      credit: rounded(amount),
    },
  ]
}

export function invertEntry(
  rows: JournalLine[],
  prefix: string,
  date: string,
  description: string,
): JournalLine[] {
  return rows.map((row) => ({
    ...row,
    id: `${prefix}-${row.id}`,
    date,
    description,
    debit: row.credit,
    credit: row.debit,
  }))
}
