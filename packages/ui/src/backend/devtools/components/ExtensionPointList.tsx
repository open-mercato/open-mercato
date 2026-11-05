'use client'

import type { UmesExtensionInfo } from '@open-mercato/shared/lib/umes/devtools-types'

const TYPE_COLORS: Record<string, string> = {
  enricher: 'bg-blue-500',
  interceptor: 'bg-amber-500',
  'component-override': 'bg-violet-500',
  'injection-widget': 'bg-emerald-500',
  'injection-data-widget': 'bg-cyan-500',
}

export function ExtensionPointList({ extensions }: { extensions: UmesExtensionInfo[] }) {
  if (extensions.length === 0) {
    return <p className="text-xs italic text-muted-foreground">No extensions registered</p>
  }

  const grouped = new Map<string, UmesExtensionInfo[]>()
  for (const ext of extensions) {
    const key = ext.type
    const group = grouped.get(key) ?? []
    group.push(ext)
    grouped.set(key, group)
  }

  return (
    <div>
      {Array.from(grouped.entries()).map(([type, items]) => (
        <div key={type} className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <span className={`inline-block size-2 rounded-full ${TYPE_COLORS[type] ?? 'bg-muted-foreground'}`} />
            {type} ({items.length})
          </div>
          <div className="pl-3.5">
            {items.map((ext, idx) => (
              <div
                key={`${ext.id}-${idx}`}
                className="flex items-center justify-between border-b border-border/70 py-1 text-xs"
              >
                <div>
                  <span className="font-medium">{ext.id}</span>
                  <span className="ml-1.5 text-muted-foreground">[{ext.moduleId}]</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-overline text-muted-foreground">{ext.target}</span>
                  {ext.priority !== 0 && (
                    <span className="rounded bg-muted px-1.5 py-px text-overline font-semibold">
                      P{ext.priority}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
