/**
 * The External IDs widget is mounted by the module's injection table, which references it by id. The
 * generator only registers widgets declared in a scanned entry file (`widget.ts|tsx` — `widget.client.tsx`
 * alone is not scanned), and it resolves the id from that file's `metadata`. This module previously
 * shipped only `widget.client.tsx`, so nothing was registered and the table's `detail:*:sidebar` entry
 * resolved to no widget: the sidebar section never rendered in any app.
 *
 * Pins the two halves together — the entry module must exist, and every id the table references must be
 * declared by it.
 */
import injectionTable from '../../../injection-table'
import widget from '../widget'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

function collectWidgetIds(table: unknown): string[] {
  const ids: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      ids.push(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === 'object') {
      const widgetId = (value as { widgetId?: unknown }).widgetId
      if (typeof widgetId === 'string') ids.push(widgetId)
    }
  }
  for (const entry of Object.values(table as Record<string, unknown>)) visit(entry)
  return ids
}

describe('integrations external-ids injection widget registration', () => {
  it('exposes a scannable entry module with the id the injection table references', () => {
    expect(widget.metadata.id).toBe('integrations.injection.external-ids')
    expect(widget.Widget).toBeDefined()
  })

  it('declares every widget id the integrations injection table references', () => {
    const referenced = collectWidgetIds(injectionTable)

    expect(referenced).toContain('integrations.injection.external-ids')
    expect(referenced.filter((id) => id !== widget.metadata.id)).toEqual([])
  })

  it('keeps the view feature gate that the widget was shipped with', () => {
    expect(widget.metadata.features).toEqual(['integrations.view'])
  })
})
