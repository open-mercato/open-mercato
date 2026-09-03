'use client'

import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Pencil } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import type { UserTaskAssigneeKind } from '../../data/validators'
import type { LedgerEntry } from '../../lib/context-ledger'
import type { TaskAssignmentMode } from '../../lib/task-inspector-config'
import {
  TASK_ASSIGNEE_KINDS,
  assignmentModesForAssigneeKind,
  coerceAssignmentModeToAssigneeKind,
  isTaskAssigneeKind,
} from '../../lib/task-inspector-config'
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
 *
 * **The audience comes first, and it GATES the tabs** (design §7.1). Addressing
 * a task to a portal customer is honoured by `resolveTaskAssignment` only when
 * an individual assignee resolves, so Role and Rule — the two modes that name no
 * individual — are not offered for that audience at all rather than offered and
 * silently discarded. The two audiences SHARE the two remaining inputs; only the
 * id space and the consequence of a fallback differ, so the copy changes and the
 * controls do not duplicate.
 */

const ASSIGNMENT_MODES: TaskAssignmentMode[] = ['role', 'user', 'dynamic', 'rule']

/**
 * The sibling form fields the assignment IS. Defaults to the USER_TASK
 * inspector's ids; the Invoke Agent node's Review section (§7.5) authors the
 * same three things under its own ids, on its own step config.
 */
export interface TaskAssignmentFieldIds {
  assignedTo: string
  assignedToRoles: string
  assignmentRule: string
}

const DEFAULT_FIELD_IDS: TaskAssignmentFieldIds = {
  assignedTo: 'assignedTo',
  assignedToRoles: 'assignedToRoles',
  assignmentRule: 'assignmentRule',
}

/**
 * The two sibling fields the portal audience needs, supplied ONLY by a step that
 * can actually raise portal work.
 *
 * Its absence is a statement, not an omission: the Invoke Agent Review section
 * (§7.5) reuses this component, and `lib/agent-review.ts` fixes that task's
 * `assigneeKind` to `'user'` because a proposal is disposed from the backoffice.
 * Rendering an audience picker there would offer a choice the engine overrides.
 *
 * `entityBindings` is here because a portal task is owned by the record it is
 * bound to: `decideTaskVisibility` denies an unbound one (`portal-unbound`) for
 * every portal principal, so the count is part of whether the addressing works
 * at all — not a separate section's business.
 */
export interface TaskPortalAudienceFieldIds {
  assigneeKind: string
  entityBindings: string
}

export interface TaskAssignmentFieldProps extends CrudCustomFieldRenderProps {
  ledgerEntries?: LedgerEntry[]
  /** Which form fields carry the assignment. Defaults to the USER_TASK ids. */
  fieldIds?: TaskAssignmentFieldIds
  /**
   * Which tabs to offer. Defaults to all four. A caller that narrows this is
   * saying the omitted modes have no meaning for its step — not that they are
   * temporarily hidden — so the omitted keys are never written.
   */
  modes?: readonly TaskAssignmentMode[]
  /** Present ⇒ this step can address a portal customer. See the type doc. */
  portalAudience?: TaskPortalAudienceFieldIds
}

function readString(values: Record<string, unknown> | undefined, key: string): string {
  const value = values?.[key]
  return typeof value === 'string' ? value : ''
}

function readRoles(values: Record<string, unknown> | undefined, key: string): string[] {
  const value = values?.[key]
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
  fieldIds = DEFAULT_FIELD_IDS,
  modes = ASSIGNMENT_MODES,
  portalAudience,
}: TaskAssignmentFieldProps) {
  const t = useT()
  const [ruleSelectorOpen, setRuleSelectorOpen] = useState(false)

  const assigneeKindValue = portalAudience ? values?.[portalAudience.assigneeKind] : undefined
  const assigneeKind: UserTaskAssigneeKind =
    portalAudience && isTaskAssigneeKind(assigneeKindValue) ? assigneeKindValue : 'user'
  const isPortal = assigneeKind === 'customer'

  // The caller's own narrowing and the audience's narrowing are BOTH honoured:
  // a mode either side rules out is a mode this step cannot execute.
  const executableModes = assignmentModesForAssigneeKind(assigneeKind)
  const availableModes = modes.filter((candidate) => executableModes.includes(candidate))

  const mode: TaskAssignmentMode = availableModes.includes(value as TaskAssignmentMode)
    ? (value as TaskAssignmentMode)
    : availableModes[0] ?? 'role'
  const roles = readRoles(values, fieldIds.assignedToRoles)
  const assignedTo = readString(values, fieldIds.assignedTo)
  const assignmentRule = readString(values, fieldIds.assignmentRule)
  const boundRecords = portalAudience ? values?.[portalAudience.entityBindings] : undefined
  const isAboutSomeRecord = Array.isArray(boundRecords) && boundRecords.length > 0

  const setSibling = (fieldId: string, nextValue: unknown) => setFormValue?.(fieldId, nextValue)

  const applyModeChange = (nextMode: TaskAssignmentMode) => {
    setValue(nextMode)
    if (nextMode !== 'rule') setSibling(fieldIds.assignmentRule, '')
    if (nextMode === 'role') setSibling(fieldIds.assignedTo, '')
    if (nextMode === 'user') setSibling(fieldIds.assignedToRoles, [])
    if (nextMode === 'rule') setSibling(fieldIds.assignedTo, '')
  }

  const handleModeChange = (nextMode: string) => {
    if (!availableModes.includes(nextMode as TaskAssignmentMode)) return
    applyModeChange(nextMode as TaskAssignmentMode)
  }

  const handleAudienceChange = (nextValue: string) => {
    if (!portalAudience || !isTaskAssigneeKind(nextValue)) return
    setSibling(portalAudience.assigneeKind, nextValue)
    // A tab the new audience cannot execute must not stay selected with its
    // value still on the step, so the collapse runs the same clearing the tab
    // strip does rather than leaving an inert `assignmentRule` behind.
    const nextMode = coerceAssignmentModeToAssigneeKind(mode, nextValue)
    if (nextMode !== mode) applyModeChange(nextMode)
  }

  return (
    <div className="space-y-2">
      {portalAudience ? (
        <div className="space-y-1">
          {/* A radiogroup takes its name from `aria-labelledby`, not from a
              `<label htmlFor>` — the control it would point at is not a form
              element. */}
          <p id={`${id}-audience-label`} className="text-xs font-medium">
            {t('workflows.tasks.inspector.who.audience')}
          </p>
          <SegmentedControl
            value={assigneeKind}
            onValueChange={handleAudienceChange}
            disabled={disabled}
            size="sm"
            aria-labelledby={`${id}-audience-label`}
          >
            {TASK_ASSIGNEE_KINDS.map((candidate) => (
              <SegmentedControlItem key={candidate} value={candidate}>
                {t(`workflows.tasks.inspector.who.audiences.${candidate}`)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <p className="text-xs text-muted-foreground">
            {isPortal
              ? t('workflows.tasks.inspector.who.audienceCustomerHint')
              : t('workflows.tasks.inspector.who.audienceUserHint')}
          </p>
          {isPortal && !isAboutSomeRecord ? (
            <Alert variant="warning">
              <AlertDescription className="text-xs">
                {t('workflows.tasks.inspector.who.customerBindingRequired')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <Tabs value={mode} onValueChange={handleModeChange} variant="underline">
        <TabsList aria-label={t('workflows.tasks.inspector.who.tabsLabel')}>
          {availableModes.map((candidate) => (
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
              onChange={(nextRoles) => setSibling(fieldIds.assignedToRoles, nextRoles)}
              disabled={disabled}
            />
          </div>
        </TabsContent>

        {/* The two tabs below are SHARED by both audiences — same key, same
            control, different id space — so only their copy switches. */}
        <TabsContent value="user" className="pt-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-user`} className="text-xs font-medium">
              {isPortal
                ? t('workflows.tasks.inspector.who.customerUserId')
                : t('workflows.tasks.inspector.who.userId')}
            </Label>
            <Input
              id={`${id}-user`}
              type="text"
              value={assignedTo}
              onChange={(event) => setSibling(fieldIds.assignedTo, event.target.value)}
              placeholder={t('workflows.form.placeholders.userId')}
              disabled={disabled}
            />
            {isPortal ? (
              <p className="text-xs text-muted-foreground">
                {t('workflows.tasks.inspector.who.customerUserIdHint')}
              </p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="dynamic" className="pt-2">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-dynamic`} className="text-xs font-medium">
                {isPortal
                  ? t('workflows.tasks.inspector.who.customerDynamicExpression')
                  : t('workflows.tasks.inspector.who.dynamicExpression')}
              </Label>
              <TemplateTextControl
                id={`${id}-dynamic`}
                value={assignedTo}
                onValueChange={(nextValue) => setSibling(fieldIds.assignedTo, nextValue)}
                ledgerEntries={ledgerEntries}
                placeholder={t(
                  isPortal
                    ? 'workflows.tasks.inspector.who.customerDynamicPlaceholder'
                    : 'workflows.tasks.inspector.who.dynamicPlaceholder',
                )}
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
                onChange={(nextRoles) => setSibling(fieldIds.assignedToRoles, nextRoles)}
                disabled={disabled}
              />
            </div>
            {roles.length === 0 ? (
              <Alert variant="warning">
                <AlertDescription className="text-xs">
                  {isPortal
                    ? t('workflows.tasks.inspector.who.customerFallbackRolesRequired')
                    : t('workflows.tasks.inspector.who.fallbackRolesRequired')}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-xs text-muted-foreground">
                {isPortal
                  ? t('workflows.tasks.inspector.who.customerFallbackRolesHint')
                  : t('workflows.tasks.inspector.who.fallbackRolesHint')}
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
                onChange={(event) => setSibling(fieldIds.assignmentRule, event.target.value)}
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
            setSibling(fieldIds.assignmentRule, ruleId)
            setRuleSelectorOpen(false)
          }}
          title={t('workflows.tasks.inspector.who.pickRule')}
          description={t('workflows.tasks.inspector.who.pickRuleDescription')}
        />
      )}
    </div>
  )
}
