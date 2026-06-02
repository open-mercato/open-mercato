import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type Translator = (key: string, fallback?: string) => string

export type SenderOption = {
  value: string
  label: string
  description?: string | null
}

export type MessagesInboxFilterContext = {
  t: Translator
  typeOptions: { value: string; label: string }[]
  senderOptions: SenderOption[]
  loadSenderOptions: (query?: string) => Promise<SenderOption[]>
}

export function buildMessagesInboxFilters({
  t,
  typeOptions,
  senderOptions,
  loadSenderOptions,
}: MessagesInboxFilterContext): FilterDef[] {
  const senderLabel = (val: string): string => {
    const match = senderOptions.find((opt) => opt.value === val)
    return match?.label ?? val
  }

  return [
    {
      id: 'status',
      label: t('messages.filters.status', 'Status'),
      type: 'select',
      options: [
        { value: '', label: t('messages.filters.all', 'All') },
        { value: 'unread', label: t('messages.status.unread', 'Unread') },
        { value: 'read', label: t('messages.status.read', 'Read') },
        { value: 'archived', label: t('messages.status.archived', 'Archived') },
      ],
    },
    {
      id: 'type',
      label: t('messages.filters.type', 'Type'),
      type: 'select',
      options: [{ value: '', label: t('messages.filters.all', 'All') }, ...typeOptions],
    },
    {
      id: 'hasObjects',
      label: t('messages.filters.hasObjects', 'Has related records'),
      tooltip: t('messages.filters.hasObjectsTooltip', 'Shows messages that have Open Mercato records attached — such as orders, quotes, or customers.'),
      type: 'select',
      options: [
        { value: '', label: t('messages.filters.all', 'All') },
        { value: 'true', label: t('common.yes', 'Yes') },
        { value: 'false', label: t('common.no', 'No') },
      ],
    },
    {
      id: 'hasAttachments',
      label: t('messages.filters.hasAttachments', 'Has attachments'),
      type: 'select',
      options: [
        { value: '', label: t('messages.filters.all', 'All') },
        { value: 'true', label: t('common.yes', 'Yes') },
        { value: 'false', label: t('common.no', 'No') },
      ],
    },
    {
      id: 'hasActions',
      label: t('messages.filters.hasActions', 'Has action requests'),
      tooltip: t('messages.filters.hasActionsTooltip', 'Shows messages where one or more attached records require a response (approval, rejection, or review).'),
      type: 'select',
      options: [
        { value: '', label: t('messages.filters.all', 'All') },
        { value: 'true', label: t('common.yes', 'Yes') },
        { value: 'false', label: t('common.no', 'No') },
      ],
    },
    {
      id: 'senderId',
      label: t('messages.filters.sender', 'Sender'),
      type: 'combobox',
      placeholder: t('messages.filters.senderEmpty', 'Type to search users'),
      options: senderOptions,
      loadOptions: loadSenderOptions,
      formatValue: senderLabel,
      formatDescription: (val: string) =>
        senderOptions.find((opt) => opt.value === val)?.description ?? null,
    },
    {
      id: 'since',
      label: t('messages.filters.since', 'Sent after'),
      type: 'text',
      placeholder: t('messages.filters.sincePlaceholder', 'YYYY-MM-DD'),
    },
  ]
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function normalizeMessagesSinceValue(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (DATE_ONLY_PATTERN.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime())) return null
    if (parsed.toISOString().slice(0, 10) !== trimmed) return null
    return parsed.toISOString()
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export type BuildMessagesListParamsOptions = {
  folder: string
  page: number
  pageSize: number
  search: string
  filterValues: FilterValues
}

export function buildMessagesListParams({
  folder,
  page,
  pageSize,
  search,
  filterValues,
}: BuildMessagesListParamsOptions): URLSearchParams {
  const params = new URLSearchParams()
  params.set('folder', folder)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))

  if (search.trim()) {
    params.set('search', search.trim())
  }

  const stringValue = (id: string): string => {
    const raw = filterValues[id]
    return typeof raw === 'string' ? raw.trim() : ''
  }

  const status = stringValue('status')
  const type = stringValue('type')
  const hasObjects = stringValue('hasObjects')
  const hasAttachments = stringValue('hasAttachments')
  const hasActions = stringValue('hasActions')
  const senderId = stringValue('senderId')
  const sinceRaw = stringValue('since')

  if (status) params.set('status', status)
  if (type) params.set('type', type)
  if (hasObjects) params.set('hasObjects', hasObjects)
  if (hasAttachments) params.set('hasAttachments', hasAttachments)
  if (hasActions) params.set('hasActions', hasActions)
  if (senderId) params.set('senderId', senderId)
  if (sinceRaw) {
    const normalized = normalizeMessagesSinceValue(sinceRaw)
    if (normalized) params.set('since', normalized)
  }

  return params
}
