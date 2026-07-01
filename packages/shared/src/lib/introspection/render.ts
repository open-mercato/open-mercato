import type { PlatformMap, SurfaceProvider } from './types'

function formatCell(value: string | number | boolean | string[] | null | undefined): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value
  return value + ' '.repeat(width - value.length)
}

export function renderSurfaceTable(provider: SurfaceProvider, rows: PlatformMap['surfaces'][string]['rows']): string {
  const { columns } = provider.describe()
  if (rows.length === 0) {
    return `  (no rows)\n`
  }

  const widths = columns.map((column) => {
    const values = rows.map((row) => formatCell(row[column]))
    return Math.max(column.length, ...values.map((value) => value.length))
  })

  const header = columns.map((column, index) => pad(column, widths[index])).join('  ')
  const divider = widths.map((width) => '-'.repeat(width)).join('  ')
  const body = rows
    .map((row) => columns.map((column, index) => pad(formatCell(row[column]), widths[index])).join('  '))
    .join('\n')

  return `${header}\n${divider}\n${body}\n`
}

export function renderPlatformMapHuman(map: PlatformMap, providersById: Map<string, SurfaceProvider>): string {
  const lines: string[] = []
  lines.push(`Platform Map (schema v${map.schemaVersion})`)
  lines.push(`Generated: ${map.generatedAt}`)
  if (map.scope) {
    lines.push(`Scope: tenant=${map.scope.tenantId ?? '—'} org=${map.scope.organizationId ?? '—'}`)
  }
  lines.push('')

  for (const [surfaceId, surface] of Object.entries(map.surfaces).sort(([a], [b]) => a.localeCompare(b))) {
    const provider = providersById.get(surfaceId)
    const title = provider?.title ?? surfaceId
    lines.push(`${title} [${surfaceId}] (tier ${surface.tier}, ${surface.rows.length} rows)`)
    lines.push('─'.repeat(Math.min(72, title.length + 20)))
    if (provider) {
      lines.push(renderSurfaceTable(provider, surface.rows))
    } else {
      lines.push(`  ${surface.rows.length} row(s)\n`)
    }
  }

  return lines.join('\n')
}
