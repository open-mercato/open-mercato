"use client"

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { normalizeNumber } from './lineItemUtils'

const STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued',
  sent: 'Sent',
  paid: 'Paid',
  partially_paid: 'Partially paid',
  partial: 'Partially paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  void: 'Void',
  refunded: 'Refunded',
}

function normalizeStatusKey(status: string): string {
  return status.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function humanizeStatus(status: string): string {
  return status
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
}

export function formatInvoiceStatus(status: string | null | undefined, t: TranslateFn): string {
  const raw = status?.trim()
  if (!raw) return ''
  const key = normalizeStatusKey(raw)
  const fallback = STATUS_FALLBACKS[key] ?? humanizeStatus(raw)
  return t(`sales.invoices.status.${key}`, fallback)
}

export function formatInvoiceMoney(value: unknown, currency: string | null | undefined): string {
  const amount = normalizeNumber(value, 0)
  const normalizedCurrency = currency?.trim().toUpperCase()
  if (!normalizedCurrency) return amount.toFixed(2)

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'code',
    })
      .format(amount)
      .replace(/[\u00a0\u202f]/g, ' ')
  } catch {
    return `${amount.toFixed(2)} ${normalizedCurrency}`
  }
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}
