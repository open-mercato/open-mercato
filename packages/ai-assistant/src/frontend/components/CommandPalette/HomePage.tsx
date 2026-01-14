'use client'

import * as React from 'react'
import { useMemo } from 'react'
import { Command } from 'cmdk'
import { Wrench, Clock, Search, Sparkles } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ToolInfo } from '../../types'
import { MODULE_ICONS } from '../../constants'

interface HomePageProps {
  search: string
  tools: ToolInfo[]
  recentTools: ToolInfo[]
  selectedIndex: number
  onSelectTool: (tool: ToolInfo) => void
  onIndexChange: (index: number) => void
}

function EmptyState() {
  return (
    <div className="py-8 px-4 text-center">
      <div className="flex justify-center mb-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
      </div>
      <h3 className="font-medium mb-2">AI Assistant</h3>
      <ul className="text-sm text-muted-foreground space-y-1.5">
        <li className="flex items-center justify-center gap-2">
          <Search className="h-3 w-3" />
          <span>Type to search tools</span>
        </li>
        <li className="flex items-center justify-center gap-2">
          <span className="font-mono text-xs">/</span>
          <span>Show all available tools</span>
        </li>
      </ul>
    </div>
  )
}

function NoResultsState({ query }: { query: string }) {
  return (
    <div className="py-6 px-4 text-center text-muted-foreground">
      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">
        No tools found for <span className="font-medium">"{query}"</span>
      </p>
    </div>
  )
}

interface ToolItemProps {
  tool: ToolInfo
  isSelected: boolean
  isRecent?: boolean
  onSelect: () => void
}

function ToolItem({ tool, isSelected, isRecent, onSelect }: ToolItemProps) {
  const moduleIcon = tool.module ? MODULE_ICONS[tool.module] : null

  return (
    <Command.Item
      value={tool.name}
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer',
        'transition-colors',
        isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center h-8 w-8 rounded-md',
          isSelected ? 'bg-primary/20' : 'bg-muted'
        )}
      >
        {isRecent ? (
          <Clock className="h-4 w-4" />
        ) : (
          <Wrench className="h-4 w-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{tool.name}</p>
        <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
      </div>
      {tool.module && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {tool.module}
        </span>
      )}
    </Command.Item>
  )
}

function groupToolsByModule(tools: ToolInfo[]): Record<string, ToolInfo[]> {
  const groups: Record<string, ToolInfo[]> = {}
  for (const tool of tools) {
    const module = tool.module || 'Other'
    if (!groups[module]) {
      groups[module] = []
    }
    groups[module].push(tool)
  }
  return groups
}

export function HomePage({
  search,
  tools,
  recentTools,
  selectedIndex,
  onSelectTool,
  onIndexChange,
}: HomePageProps) {
  const hasSearch = search.length > 0 && !search.startsWith('/')
  const showAllTools = search === '/'

  // Get all items for index calculation
  const allItems = useMemo(() => {
    if (!hasSearch && !showAllTools && recentTools.length > 0) {
      return recentTools
    }
    return tools
  }, [hasSearch, showAllTools, recentTools, tools])

  // Group tools by module for display when showing all
  const groupedTools = useMemo(() => groupToolsByModule(tools), [tools])

  // Empty state - no search and no recent tools
  if (!hasSearch && !showAllTools && recentTools.length === 0 && tools.length === 0) {
    return <EmptyState />
  }

  // No results state
  if (hasSearch && tools.length === 0) {
    return <NoResultsState query={search} />
  }

  // Show empty state hint when no search
  if (!hasSearch && !showAllTools && recentTools.length === 0) {
    return <EmptyState />
  }

  return (
    <Command.List className="max-h-[400px] overflow-y-auto p-2">
      {/* Show recent tools when not searching */}
      {!hasSearch && !showAllTools && recentTools.length > 0 && (
        <Command.Group>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Recent
          </div>
          {recentTools.map((tool, i) => (
            <ToolItem
              key={`recent-${tool.name}`}
              tool={tool}
              isSelected={i === selectedIndex}
              isRecent
              onSelect={() => onSelectTool(tool)}
            />
          ))}
        </Command.Group>
      )}

      {/* Show filtered tools when searching */}
      {hasSearch && (
        <Command.Group>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Search className="h-3 w-3" />
            Results
          </div>
          {tools.map((tool, i) => (
            <ToolItem
              key={tool.name}
              tool={tool}
              isSelected={i === selectedIndex}
              onSelect={() => onSelectTool(tool)}
            />
          ))}
        </Command.Group>
      )}

      {/* Show all tools grouped by module when using / */}
      {showAllTools &&
        Object.entries(groupedTools).map(([module, moduleTools]) => (
          <Command.Group key={module}>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {module}
            </div>
            {moduleTools.map((tool) => {
              const globalIndex = tools.findIndex((t) => t.name === tool.name)
              return (
                <ToolItem
                  key={tool.name}
                  tool={tool}
                  isSelected={globalIndex === selectedIndex}
                  onSelect={() => onSelectTool(tool)}
                />
              )
            })}
          </Command.Group>
        ))}
    </Command.List>
  )
}
