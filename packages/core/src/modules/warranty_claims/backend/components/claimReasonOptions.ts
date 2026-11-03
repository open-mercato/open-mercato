"use client"

import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { localizeDictionaryLabel } from '../../lib/dictionaryLabels'

const CLAIM_REASON_DICTIONARY_KEY = 'warranty_claims.warranty_claim_reason'

type DictionaryListItem = {
  id?: string
  key?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null
}

function normalizeDictionaryOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const value = toStringOrNull(item.value)
  if (!value) return null
  const label = toStringOrNull(item.label) ?? value
  return { value, label }
}

export async function fetchClaimReasonOptions(t: TranslateFn): Promise<CrudFieldOption[]> {
  const dictionaries = await readApiResultOrThrow<{ items?: DictionaryListItem[] }>(
    '/api/dictionaries',
    undefined,
    {
      fallback: { items: [] },
      errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
    },
  )
  const dictionary = (dictionaries.items ?? []).find((item) => item.key === CLAIM_REASON_DICTIONARY_KEY)
  if (!dictionary?.id) return []
  const entries = await readApiResultOrThrow<{ items?: unknown[] }>(
    `/api/dictionaries/${encodeURIComponent(dictionary.id)}/entries`,
    undefined,
    {
      fallback: { items: [] },
      errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
    },
  )
  return (entries.items ?? [])
    .map(normalizeDictionaryOption)
    .filter((option): option is CrudFieldOption => option !== null)
    .map((option) => ({
      value: option.value,
      label: localizeDictionaryLabel(t, 'reason', option.value, option.label),
    }))
}
