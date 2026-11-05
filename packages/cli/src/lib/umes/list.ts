import { createResolver } from '../resolver'
import { collectUmesData } from './collector'

export async function runUmesList(): Promise<void> {
  const resolver = createResolver()
  const modulesData = collectUmesData(resolver)

  const allExtensions = modulesData.flatMap((m) => m.extensions)

  if (allExtensions.length === 0) {
    console.log('No UMES extensions found.')
    return
  }

  // Column widths
  const colModule = 'Module'
  const colType = 'Type'
  const colId = 'ID'
  const colTarget = 'Target'
  const colPriority = 'Priority'
  const colFeatures = 'Features'

  const rows = allExtensions.map((ext) => ({
    module: ext.moduleId,
    type: ext.type,
    id: ext.id,
    target: ext.target,
    priority: String(ext.priority),
    features: ext.features?.join(', ') ?? '',
  }))

  const widths = {
    module: Math.max(colModule.length, ...rows.map((r) => r.module.length)),
    type: Math.max(colType.length, ...rows.map((r) => r.type.length)),
    id: Math.max(colId.length, ...rows.map((r) => r.id.length)),
    target: Math.max(colTarget.length, ...rows.map((r) => r.target.length), 6),
    priority: Math.max(colPriority.length, ...rows.map((r) => r.priority.length)),
    features: Math.max(colFeatures.length, ...rows.map((r) => r.features.length), 8),
  }

  const pad = (s: string, w: number) => s.padEnd(w)
  const sep = `${'─'.repeat(widths.module + 2)}┼${'─'.repeat(widths.type + 2)}┼${'─'.repeat(widths.id + 2)}┼${'─'.repeat(widths.target + 2)}┼${'─'.repeat(widths.priority + 2)}┼${'─'.repeat(widths.features + 2)}`

  console.log(
    ` ${pad(colModule, widths.module)} │ ${pad(colType, widths.type)} │ ${pad(colId, widths.id)} │ ${pad(colTarget, widths.target)} │ ${pad(colPriority, widths.priority)} │ ${pad(colFeatures, widths.features)}`
  )
  console.log(sep)

  for (const row of rows) {
    console.log(
      ` ${pad(row.module, widths.module)} │ ${pad(row.type, widths.type)} │ ${pad(row.id, widths.id)} │ ${pad(row.target, widths.target)} │ ${pad(row.priority, widths.priority)} │ ${pad(row.features, widths.features)}`
    )
  }

  console.log(`\nTotal: ${allExtensions.length} extension(s) across ${modulesData.filter((m) => m.extensions.length > 0).length} module(s)`)
}
