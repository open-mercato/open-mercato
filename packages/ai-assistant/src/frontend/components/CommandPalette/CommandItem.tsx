'use client'

import * as React from 'react'
import { Command } from 'cmdk'
import {
  Plus,
  Edit,
  Trash,
  Search,
  Eye,
  List,
  Package,
  Users,
  ShoppingCart,
  Calendar,
  Lock,
  BookOpen,
  Folder,
  DollarSign,
  ToggleLeft,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ToolInfo } from '../../types'
import { humanizeToolName } from '../../utils/toolMatcher'

interface CommandItemProps {
  tool: ToolInfo
  isSelected: boolean
  onSelect: () => void
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  customers: Users,
  catalog: Package,
  sales: ShoppingCart,
  search: Search,
  auth: Lock,
  dictionaries: BookOpen,
  directory: Folder,
  currencies: DollarSign,
  feature_toggles: ToggleLeft,
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  create: Plus,
  update: Edit,
  delete: Trash,
  search: Search,
  query: Search,
  get: Eye,
  list: List,
}

function getIcon(tool: ToolInfo): LucideIcon {
  // First try to match action
  const nameParts = tool.name.split('.')
  const action = nameParts[nameParts.length - 1]
  if (ACTION_ICONS[action]) {
    return ACTION_ICONS[action]
  }

  // Then try module
  const module = tool.module || nameParts[0]
  if (MODULE_ICONS[module]) {
    return MODULE_ICONS[module]
  }

  return Zap
}

export function CommandItem({ tool, isSelected, onSelect }: CommandItemProps) {
  const Icon = getIcon(tool)
  const displayName = humanizeToolName(tool.name)
  const module = tool.module || tool.name.split('.')[0]

  return (
    <Command.Item
      value={tool.name}
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer rounded-md',
        'text-sm text-foreground',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/50'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-md',
          'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{displayName}</div>
        <div className="text-xs text-muted-foreground truncate">
          {tool.description}
        </div>
      </div>

      <span className="text-xs text-muted-foreground capitalize">
        {module}
      </span>
    </Command.Item>
  )
}
