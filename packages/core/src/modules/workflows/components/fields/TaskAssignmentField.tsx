'use client'

import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Pencil } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import type { LedgerEntry } from '../../lib/context-ledger'
import type { TaskAssignmentMode } from '../../lib/task-inspector-config'
import { BusinessRulesSelector } from '../BusinessRulesSelector'
import { RolesMultiSelect } from './RolesMultiSelect'
import { TemplateTextControl } from './TemplateTextControl'

/**
 * "Who" (spec §6.1, section 3): the four assignment tabs.
 *
 * The tab is DERIVED, never stored — the assignment IS the three config keys
 * (`assignedTo`, `assignedToRoles`, `assignmentRule`), so switching tabs clears
 * the keys the new tab does not own rather than introducing a fifth source of
 * truth the engine would have to agree with. That is why this field drives its
 * siblings through `setFormValue` instead of owning a compound value.
 *
 * **Dynamic requires a role queue.** `resolveTaskAssignment` falls back to the
 * authored roles whenever a pill resolves to nothing (a missing path, an empty
 * value, an un-substituted token), and a dynamic assignment without that queue
 * creates a task nobody can see. The role picker is therefore part of the
 * Dynamic tab, marked required, with the consequence spelled out — the engine
 * implements the fallback, this is what makes it mandatory.
 */

const ASSIGNMENT_MODES: TaskAssignmentMode[] = ['role', 'user', 'dynamic', 'rule']

export interface TaskAssignmentFieldProps extends CrudCustomFieldRenderProps {
  ledgerEntries?: LedgerEntry[]
}

function readString(values: Record<string, unknown> | undefined, key: string): string {
  const value = values?.[key]
  return typeof value === 'string' ? value : ''
}

function readRoles(values: Record<string, unknown> | undefined): string[] {
  const value = values?.assignedToRoles
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (typeof value === 'string') return value.split(',').map((role) => role.trim()).filter(Boolean)
  return []
}

export function TaskAssignmentField({
  id,
  value,
  setValue,
  setFormValue,
  values,
  disabled,
  ledgerEntries,
}: TaskAssignmentFieldProps) {
  const t = useT()
  const [ruleSelectorOpen, setRuleSelectorOpen] = useState(false)

  const mode: TaskAssignmentMode = ASSIGNMENT_MODES.includes(value as TaskAssignmentMode)
    ? (value as TaskAssignmentMode)
    : 'role'
  const roles = readRoles(values)
  const assignedTo = readString(values, 'assignedTo')
  const assignmentRule = readString(values, 'assignmentRule')

  const setSibling = (fieldId: string, nextValue: unknown) => setFormValue?.(fieldId, nextValue)

  const handleModeChange = (nextMode: string) => {
    if (!ASSIGNMENT_MODES.includes(nextMode as TaskAssignmentMode)) return
    setValue(nextMode)
    if (nextMode !== 'rule') setSibling('assignmentRule', '')
    if (nextMode === 'role') setSibling('assignedTo', '')
    if (nextMode === 'user') setSibling('assignedToRoles', [])
    if (nextMode === 'rule') setSibling('assignedTo', '')
  }

  return (
    <div className="space-y-2">
      <Tabs value={mode} onValueChange={handleModeChange} variant="underline">
        <TabsList aria-label={t('workflows.tasks.inspector.who.tabsLabel')}>
          {ASSIGNMENT_MODES.map((candidate) => (
            <TabsTrigger key={candidate} value={candidate} disabled={disabled}>
              {t(`workflows.tasks.inspector.who.modes.${candidate}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="role" className="pt-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-roles`} className="text-xs font-medium">
              {t('workflows.tasks.inspector.who.roleQueue')}
            </Label>
            <RolesMultiSelect
              id={`${id}-roles`}
              value={roles}
              onChange={(nextRoles) => setSibling('assignedToRoles', nextRoles)}
              disabled={disabled}
            />
          </div>
        </TabsContent>

        <TabsContent value="user" className="pt-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-user`} className="text-xs font-medium">
              {t('workflows.tasks.inspector.who.userId')}
            </Label>
            <Input
              id={`${id}-user`}
              type="text"
              value={assignedTo}
              onChange={(event) => setSibling('assignedTo', event.target.value)}
              placeholder={t('workflows.form.placeholders.userId')}
              disabled={disabled}
            />
          </div>
        </TabsContent>

        <TabsContent value="dynamic" className="pt-2">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-dynamic`} className="text-xs font-medium">
                {t('workflows.tasks.inspector.who.dynamicExpression')}
              </Label>
              <TemplateTextControl
                id={`${id}-dynamic`}
                value={assignedTo}
                onValueChange={(nextValue) => setSibling('assignedTo', nextValue)}
                ledgerEntries={ledgerEntries}
                placeholder={t('workflows.tasks.inspector.who.dynamicPlaceholder')}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-fallback-roles`} className="text-xs font-medium">
                {t('workflows.tasks.inspector.who.fallbackRoles')}
                <span className="text-status-error-text"> *</span>
              </Label>
              <RolesMultiSelect
                id={`${id}-fallback-roles`}
                value={roles}
                onChange={(nextRoles) => setSibling('assignedToRoles', nextRoles)}
                disabled={disabled}
              />
            </div>
            {roles.length === 0 ? (
              <Alert variant="warning">
                <AlertDescription className="text-xs">
                  {t('workflows.tasks.inspector.who.fallbackRolesRequired')}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('workflows.tasks.inspector.who.fallbackRolesHint')}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="rule" className="pt-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-rule`} className="text-xs font-medium">
              {t('workflows.tasks.inspector.who.rule')}
            </Label>
            <div className="flex items-center gap-1">
              <Input
                id={`${id}-rule`}
                type="text"
                value={assignmentRule}
                onChange={(event) => setSibling('assignmentRule', event.target.value)}
                placeholder={t('workflows.tasks.inspector.who.rulePlaceholder')}
                disabled={disabled}
                className="flex-1 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setRuleSelectorOpen(true)}
              >
                <Pencil className="size-3.5 mr-1" />
                {t('workflows.tasks.inspector.who.pickRule')}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {ruleSelectorOpen && (
        <BusinessRulesSelector
          isOpen
          onClose={() => setRuleSelectorOpen(false)}
          onSelect={(ruleId) => {
            setSibling('assignmentRule', ruleId)
            setRuleSelectorOpen(false)
          }}
          title={t('workflows.tasks.inspector.who.pickRule')}
          description={t('workflows.tasks.inspector.who.pickRuleDescription')}
        />
      )}
    </div>
  )
}
