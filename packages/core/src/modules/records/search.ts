import type { SearchBuildContext, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isNaN(ts) ? null : value.toISOString()
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function readRecordText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const text = normalizeText(record[key])
    if (text) return text
  }
  return null
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => normalizeText(part))
    .filter((value): value is string => Boolean(value))
  if (!text.length) return undefined
  return text.join(' · ')
}

function presenterIncomingShipment(ctx: SearchBuildContext): SearchResultPresenter {
  const rpw = readRecordText(ctx.record, 'rpw_number', 'rpwNumber')
  const subject = readRecordText(ctx.record, 'subject')
  const id = readRecordText(ctx.record, 'id')
  const sender = readRecordText(ctx.record, 'sender_display_name', 'senderDisplayName')
  const receivedAt = readRecordText(ctx.record, 'received_at', 'receivedAt')
  const title = rpw ?? subject ?? id ?? 'Incoming shipment'
  const subtitle = formatSubtitle(sender, receivedAt)
  return { title, subtitle, icon: 'inbox', badge: 'Incoming' }
}

function presenterJrwaClass(ctx: SearchBuildContext): SearchResultPresenter {
  const code = readRecordText(ctx.record, 'code')
  const name = readRecordText(ctx.record, 'name')
  const id = readRecordText(ctx.record, 'id')
  const title = code && name ? `${code} — ${name}` : code ?? name ?? id ?? 'JRWA'
  return { title, subtitle: undefined, icon: 'folder-tree', badge: 'JRWA' }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'records:incoming_shipment',
      enabled: true,
      priority: 5,
      formatResult: async (ctx) => presenterIncomingShipment(ctx),
    },
    {
      entityId: 'records:jrwa_class',
      enabled: true,
      priority: 5,
      formatResult: async (ctx) => presenterJrwaClass(ctx),
    },
  ],
}

export default searchConfig
