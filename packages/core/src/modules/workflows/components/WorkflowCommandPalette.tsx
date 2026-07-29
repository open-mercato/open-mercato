'use client'

import * as React from 'react'
import {
  CommandMenu,
  CommandMenuContent,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuGroup,
  CommandMenuInput,
  CommandMenuItem,
  CommandMenuList,
} from '@open-mercato/ui/primitives/command-menu'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  groupWorkflowEditorCommands,
  type WorkflowCommandGroupId,
  type WorkflowEditorCommand,
} from '../lib/editor-commands'

export interface WorkflowCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: WorkflowEditorCommand[]
}

/**
 * Cmd+K palette for the Studio (spec section 4.6).
 *
 * It reuses the platform's `CommandMenu` primitive rather than introducing a
 * second palette: `cmdk` already provides the search filtering, arrow-key
 * navigation and Enter-to-select this needs, and Radix's dialog gives it the
 * focus trap and Escape contract every other dialog in the product has.
 */
export function WorkflowCommandPalette({ open, onOpenChange, commands }: WorkflowCommandPaletteProps) {
  const t = useT()
  const sections = React.useMemo(() => groupWorkflowEditorCommands(commands), [commands])

  const groupHeadings: Record<WorkflowCommandGroupId, string> = {
    edit: t('workflows.commandPalette.groups.edit', 'Edit'),
    add: t('workflows.commandPalette.groups.add', 'Add'),
    navigate: t('workflows.commandPalette.groups.navigate', 'Go to'),
    view: t('workflows.commandPalette.groups.view', 'View'),
    run: t('workflows.commandPalette.groups.run', 'Run'),
  }

  return (
    <CommandMenu open={open} onOpenChange={onOpenChange}>
      <CommandMenuContent title={t('workflows.commandPalette.title', 'Workflow commands')}>
        <CommandMenuInput
          placeholder={t('workflows.commandPalette.placeholder', 'Search commands…')}
          clearAriaLabel={t('workflows.commandPalette.clear', 'Clear search')}
        />
        <CommandMenuList>
          <CommandMenuEmpty>{t('workflows.commandPalette.empty', 'No matching command')}</CommandMenuEmpty>
          {sections.map((section) => (
            <CommandMenuGroup key={section.group} heading={groupHeadings[section.group]}>
              {section.commands.map((command) => (
                <CommandMenuItem
                  key={command.id}
                  value={`${command.label} ${command.description ?? ''}`}
                  disabled={command.disabled}
                  description={command.description}
                  shortcut={command.shortcut ? <Kbd>{command.shortcut}</Kbd> : undefined}
                  onSelect={() => {
                    if (command.disabled) return
                    onOpenChange(false)
                    command.run()
                  }}
                >
                  {command.label}
                </CommandMenuItem>
              ))}
            </CommandMenuGroup>
          ))}
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenuContent>
    </CommandMenu>
  )
}
