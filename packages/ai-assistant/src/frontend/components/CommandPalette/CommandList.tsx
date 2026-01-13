'use client'

import * as React from 'react'
import { Command } from 'cmdk'
import { Clock } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ToolInfo, RecentAction } from '../../types'
import { CommandItem } from './CommandItem'
import { groupToolsByModule } from '../../utils/toolMatcher'

interface CommandListProps {
  tools: ToolInfo[]
  recentActions: RecentAction[]
  selectedIndex: number
  onSelect: (tool: ToolInfo) => void
  showRecent: boolean
}

export function CommandList({
  tools,
  recentActions,
  selectedIndex,
  onSelect,
  showRecent,
}: CommandListProps) {
  const groupedTools = React.useMemo(() => groupToolsByModule(tools), [tools])

  // Track cumulative index for selection
  let currentIndex = 0

  return (
    <Command.List className="max-h-[400px] overflow-y-auto p-2">
      {tools.length === 0 ? (
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No commands found.
        </Command.Empty>
      ) : (
        <>
          {showRecent && recentActions.length > 0 && (
            <Command.Group heading="Recent" className="mb-2">
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Recently used</span>
              </div>
              {recentActions.slice(0, 3).map((action) => {
                const tool = tools.find((t) => t.name === action.toolName)
                if (!tool) return null

                const isSelected = selectedIndex === currentIndex
                const idx = currentIndex
                currentIndex++

                return (
                  <CommandItem
                    key={action.id}
                    tool={tool}
                    isSelected={isSelected}
                    onSelect={() => onSelect(tool)}
                  />
                )
              })}
            </Command.Group>
          )}

          {Array.from(groupedTools.entries()).map(([module, moduleTools]) => (
            <Command.Group
              key={module}
              heading={humanizeModule(module)}
              className="mb-2"
            >
              {moduleTools.map((tool) => {
                const isSelected = selectedIndex === currentIndex
                currentIndex++

                return (
                  <CommandItem
                    key={tool.name}
                    tool={tool}
                    isSelected={isSelected}
                    onSelect={() => onSelect(tool)}
                  />
                )
              })}
            </Command.Group>
          ))}
        </>
      )}
    </Command.List>
  )
}

function humanizeModule(module: string): string {
  const names: Record<string, string> = {
    customers: 'Customers',
    catalog: 'Catalog',
    sales: 'Sales',
    booking: 'Booking',
    search: 'Search',
    auth: 'Authentication',
    dictionaries: 'Dictionaries',
    directory: 'Directory',
    currencies: 'Currencies',
    feature_toggles: 'Features',
    context: 'Context',
  }
  return names[module] || module.charAt(0).toUpperCase() + module.slice(1)
}
