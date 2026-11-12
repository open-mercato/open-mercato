import type { LegalAgreementType, LegalPaper } from '../data/validators'

export type StartReviewForm = {
  reference: string
  counterparty: string
  purpose: string
  jurisdiction: string
  agreementType: LegalAgreementType
  paper: LegalPaper
  dueDate: string
}

const DEFAULT_DUE_IN_DAYS = 2

function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function buildDefaultStartReviewForm(now: Date, random: () => number = Math.random): StartReviewForm {
  const due = new Date(now.getTime())
  due.setDate(due.getDate() + DEFAULT_DUE_IN_DAYS)
  const digits = String(1000 + Math.floor(random() * 9000))
  return {
    reference: `LG-${digits}`,
    counterparty: '',
    purpose: '',
    jurisdiction: 'US',
    agreementType: 'mutual_nda',
    paper: 'counterparty',
    dueDate: toDateInputValue(due),
  }
}

export function buildStartReviewPayload(
  form: StartReviewForm,
  documentId: string,
  currentUserId: string | null,
): Record<string, unknown> {
  const jurisdiction = form.jurisdiction.trim()
  const dueAt = form.dueDate ? new Date(`${form.dueDate}T17:00:00`) : null
  return {
    documentId,
    reference: form.reference.trim(),
    counterparty: form.counterparty.trim(),
    purpose: form.purpose.trim() || null,
    jurisdiction: /^[A-Za-z]{2}$/.test(jurisdiction) ? jurisdiction.toUpperCase() : null,
    agreementType: form.agreementType,
    paper: form.paper,
    requestedByUserId: currentUserId,
    assigneeUserId: currentUserId,
    dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : null,
  }
}
