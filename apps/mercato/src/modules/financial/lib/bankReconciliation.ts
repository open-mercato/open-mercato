import type { EntityManager } from '@mikro-orm/postgresql'
import { GlBankStatement, GlBankStatementLine, GlCashAccount } from '../data/entities'
import { roundDecimalHalfUp } from './money'

/**
 * Bank statement import and matching.
 *
 * The parser accepts the export shape most Saudi banks produce: one transaction
 * per line, a date, a description, an optional reference and a signed amount
 * (negative = money out). A header is skipped when its first cell is not a date.
 *
 * Matching is deliberately conservative: a statement line matches a posted cash
 * or bank ledger line only when the absolute amount is equal to the halala, the
 * direction agrees, and the posting date is within three days. Nothing is
 * matched on description text — a fuzzy match that is wrong is worse than an
 * operator matching the remainder by hand.
 */

export type ParsedBankLine = {
  lineNumber: number
  transactionDate: string
  description: string | null
  reference: string | null
  direction: 'in' | 'out'
  amount: string
}

export type ParsedBankStatement = {
  lines: ParsedBankLine[]
  errors: Array<{ lineNumber: number; message: string }>
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function parseDate(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const date = new Date(`${trimmed}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : trimmed
}

function parseAmount(value: string): { direction: 'in' | 'out'; amount: string } | null {
  const cleaned = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '')
  if (cleaned.length === 0 || cleaned === '-') return null
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed === 0) return null
  return {
    direction: parsed < 0 ? 'out' : 'in',
    amount: roundDecimalHalfUp(Math.abs(parsed), 2),
  }
}

export function parseBankStatementCsv(text: string): ParsedBankStatement {
  const lines: ParsedBankLine[] = []
  const errors: ParsedBankStatement['errors'] = []
  const rows = text.split(/\r?\n/).filter((row) => row.trim().length > 0)
  let lineNumber = 0
  for (const row of rows) {
    const cells = splitCsvLine(row)
    const date = parseDate(cells[0] ?? '')
    if (!date) {
      if (lines.length === 0 && errors.length === 0) continue
      lineNumber += 1
      errors.push({ lineNumber, message: 'invalid_date' })
      continue
    }
    const amountCell = cells.length >= 4 ? cells[cells.length - 1] : cells[2]
    const amount = parseAmount(amountCell ?? '')
    if (!amount) {
      lineNumber += 1
      errors.push({ lineNumber, message: 'invalid_amount' })
      continue
    }
    lineNumber += 1
    lines.push({
      lineNumber,
      transactionDate: date,
      description: (cells[1] ?? '').trim() || null,
      reference: cells.length >= 4 ? ((cells[2] ?? '').trim() || null) : null,
      direction: amount.direction,
      amount: amount.amount,
    })
  }
  return { lines, errors }
}

type CandidateRow = {
  id: string
  entry_id: string
  debit_amount: string
  credit_amount: string
  posting_date: Date | string
}

function dayDistance(left: string, right: string): number {
  return Math.abs(Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / 86_400_000
}

export async function matchBankStatement(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  statementId: string,
): Promise<{ matched: number; unmatched: number }> {
  const statement = await em.findOne(GlBankStatement, {
    id: statementId,
    ...scope,
  })
  if (!statement) throw new Error('[internal] Statement not found')
  const cashAccount = await em.findOne(GlCashAccount, {
    id: statement.cashAccountId,
    ...scope,
    deletedAt: null,
  })
  if (!cashAccount) throw new Error('[internal] Cash account not found')

  const lines = await em.find(GlBankStatementLine, {
    statementId,
    ...scope,
    status: 'unmatched',
  }, { orderBy: { lineNumber: 'asc' } })
  if (lines.length === 0) return { matched: 0, unmatched: 0 }

  const dates = lines.map((line) => line.transactionDate.getTime())
  const from = new Date(Math.min(...dates) - 3 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(Math.max(...dates) + 3 * 86_400_000).toISOString().slice(0, 10)
  const candidates = await em.getConnection().execute<CandidateRow[]>(
    `select l.id, l.entry_id, l.debit_amount, l.credit_amount, e.posting_date
     from gl_journal_lines l
     join gl_journal_entries e on e.id = l.entry_id
     where e.tenant_id = ? and e.organization_id = ? and e.status = 'posted'
       and l.account_id = ? and e.posting_date between ? and ?
       and not exists (
         select 1 from gl_bank_statement_lines b where b.matched_entry_line_id = l.id
       )`,
    [scope.tenantId, scope.organizationId, cashAccount.accountId, from, to],
  )

  let matched = 0
  const used = new Set<string>()
  for (const line of lines) {
    const lineDate = line.transactionDate.toISOString().slice(0, 10)
    const lineAmount = roundDecimalHalfUp(line.amount, 2)
    const candidate = candidates
      .filter((row) => !used.has(row.id))
      .filter((row) => {
        const postedDate = new Date(row.posting_date).toISOString().slice(0, 10)
        if (dayDistance(lineDate, postedDate) > 3) return false
        const debit = roundDecimalHalfUp(row.debit_amount, 2)
        const credit = roundDecimalHalfUp(row.credit_amount, 2)
        return line.direction === 'in' ? debit === lineAmount : credit === lineAmount
      })
      .sort((left, right) => dayDistance(
        lineDate,
        new Date(left.posting_date).toISOString().slice(0, 10),
      ) - dayDistance(lineDate, new Date(right.posting_date).toISOString().slice(0, 10)))[0]
    if (!candidate) continue
    used.add(candidate.id)
    line.status = 'matched'
    line.matchedEntryLineId = candidate.id
    line.matchedAt = new Date()
    matched += 1
  }
  const remaining = lines.length - matched
  statement.status = remaining === 0 ? 'reconciled' : 'imported'
  statement.updatedAt = new Date()
  await em.flush()
  return { matched, unmatched: remaining }
}
