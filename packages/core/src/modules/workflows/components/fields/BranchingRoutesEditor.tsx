'use client'

import { useMemo, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/components/utils/conditionValidation'
import { BusinessRulesSelector } from '../BusinessRulesSelector'
import { VariablePickerButton } from './VariablePickerButton'
import { ledgerDropTargetProps } from './ledgerDropTarget'
import type { LedgerEntry } from '../../lib/context-ledger'
import {
  collectDuplicateCaseValues,
  ensureOtherwiseRoute,
  type BranchingRouteDraft,
  type SwitchRoutesValue,
} from '../../lib/branching-routes'

/**
 * If/Else + Switch route inspectors (spec
 * 2026-07-26-workflows-ux-redesign.md section 5.8).
 *
 * Both inspectors edit the branching node's OUTGOING TRANSITIONS and nothing
 * else: a case route carries either an inline condition in the business_rules
 * expression language (edited with the shared ConditionBuilder) or a reference
 * to a saved Business Rule, and exactly one route stays unconditioned as the
 * otherwise route. Compilation into edge data lives in the pure
 * lib/branching-routes.ts.
 */

interface RouteHeaderProps {
  route: BranchingRouteDraft
  disabled?: boolean
  onMakeOtherwise: () => void
}

function RouteHeader({ route, disabled, onMakeOtherwise }: RouteHeaderProps) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Badge variant={route.kind === 'otherwise' ? 'secondary' : 'outline'}>
          {route.kind === 'otherwise'
            ? t('workflows.branching.otherwiseBadge', 'Otherwise')
            : t('workflows.branching.caseBadge', 'Case')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {t('workflows.branching.routeTarget', 'Routes to {stepId}', { stepId: route.toStepId })}
        </span>
      </div>
      {route.kind === 'case' && (
        <Button type="button" variant="ghost" size="sm" onClick={onMakeOtherwise} disabled={disabled}>
          {t('workflows.branching.makeOtherwise', 'Use as otherwise')}
        </Button>
      )}
    </div>
  )
}

function EmptyRoutesAlert() {
  const t = useT()
  return (
    <Alert variant="info">
      <AlertDescription>
        {t(
          'workflows.branching.noRoutes',
          'Connect this step to its next steps on the canvas — every connection becomes a route you can condition here.',
        )}
      </AlertDescription>
    </Alert>
  )
}

function SingleRouteAlert() {
  const t = useT()
  return (
    <Alert variant="warning">
      <AlertDescription>
        {t(
          'workflows.branching.singleRoute',
          'Add a second outgoing connection so this step has both a conditioned route and an otherwise route.',
        )}
      </AlertDescription>
    </Alert>
  )
}

function useNormalizedRoutes(routes: BranchingRouteDraft[] | undefined): BranchingRouteDraft[] {
  return useMemo(() => ensureOtherwiseRoute(Array.isArray(routes) ? routes : []), [routes])
}

export interface IfElseRoutesFieldProps {
  id: string
  value?: BranchingRouteDraft[]
  setValue: (next: BranchingRouteDraft[]) => void
  disabled?: boolean
}

export function IfElseRoutesField({ id, value, setValue, disabled }: IfElseRoutesFieldProps) {
  const t = useT()
  const routes = useNormalizedRoutes(value)
  const [ruleSelectorTransitionId, setRuleSelectorTransitionId] = useState<string | null>(null)

  const updateRoute = (transitionId: string, patch: Partial<BranchingRouteDraft>) => {
    setValue(routes.map((route) => (route.transitionId === transitionId ? { ...route, ...patch } : route)))
  }

  const makeOtherwise = (transitionId: string) => {
    setValue(
      ensureOtherwiseRoute(
        routes.map((route) => ({
          ...route,
          kind: route.transitionId === transitionId ? 'otherwise' : 'case',
        })),
      ),
    )
  }

  if (routes.length === 0) return <EmptyRoutesAlert />

  return (
    <div className="flex flex-col gap-4">
      {routes.length === 1 && <SingleRouteAlert />}
      {routes.map((route) => (
        <div key={route.transitionId} className="rounded-md border border-border p-3">
          <RouteHeader route={route} disabled={disabled} onMakeOtherwise={() => makeOtherwise(route.transitionId)} />

          {route.kind === 'otherwise' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                'workflows.branching.otherwiseHint',
                'The otherwise route runs when no other route matches. It is always evaluated last.',
              )}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <SwitchField
                id={`${id}-${route.transitionId}-mode`}
                label={t('workflows.branching.useBusinessRule', 'Use a Business Rule instead')}
                checked={route.mode === 'rule'}
                onCheckedChange={(checked) =>
                  updateRoute(route.transitionId, { mode: checked ? 'rule' : 'inline' })
                }
                disabled={disabled}
              />

              {route.mode === 'rule' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {route.ruleId || t('workflows.branching.noRuleSelected', 'No rule selected')}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRuleSelectorTransitionId(route.transitionId)}
                    disabled={disabled}
                  >
                    {t('workflows.branching.selectRule', 'Select rule')}
                  </Button>
                </div>
              ) : (
                <ConditionBuilder
                  value={route.condition ?? null}
                  onChangeAction={(next: GroupCondition) => updateRoute(route.transitionId, { condition: next })}
                  entityType="workflow:transition"
                />
              )}
            </div>
          )}
        </div>
      ))}

      <BusinessRulesSelector
        isOpen={ruleSelectorTransitionId !== null}
        onClose={() => setRuleSelectorTransitionId(null)}
        onSelect={(ruleId) => {
          if (ruleSelectorTransitionId) updateRoute(ruleSelectorTransitionId, { ruleId, mode: 'rule' })
          setRuleSelectorTransitionId(null)
        }}
        title={t('workflows.branching.selectRuleTitle', 'Select a business rule')}
        onlyEnabled
      />
    </div>
  )
}

export interface SwitchRoutesFieldProps {
  id: string
  value?: SwitchRoutesValue
  setValue: (next: SwitchRoutesValue) => void
  disabled?: boolean
  ledgerEntries?: LedgerEntry[]
}

export function SwitchRoutesField({ id, value, setValue, disabled, ledgerEntries }: SwitchRoutesFieldProps) {
  const t = useT()
  const field = value?.field ?? ''
  const routes = useNormalizedRoutes(value?.routes)
  const duplicates = useMemo(() => collectDuplicateCaseValues(routes), [routes])

  const commit = (nextField: string, nextRoutes: BranchingRouteDraft[]) => {
    setValue({ field: nextField, routes: nextRoutes })
  }

  const updateRoute = (transitionId: string, patch: Partial<BranchingRouteDraft>) => {
    commit(field, routes.map((route) => (route.transitionId === transitionId ? { ...route, ...patch } : route)))
  }

  const makeOtherwise = (transitionId: string) => {
    commit(
      field,
      ensureOtherwiseRoute(
        routes.map((route) => ({
          ...route,
          kind: route.transitionId === transitionId ? 'otherwise' : 'case',
        })),
      ),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor={`${id}-field`} className="mb-1 text-xs font-medium">
          {t('workflows.branching.switchField', 'Field')}
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id={`${id}-field`}
            type="text"
            value={field}
            onChange={(event) => commit(event.target.value, routes)}
            placeholder={t('workflows.branching.switchFieldPlaceholder', 'order.status')}
            className="flex-1 font-mono text-xs"
            disabled={disabled}
            {...ledgerDropTargetProps({
              value: field,
              onValueChange: (nextValue) => commit(nextValue, routes),
              insertMode: 'bare',
              disabled,
            })}
          />
          <VariablePickerButton
            targetId={`${id}-field`}
            value={field}
            onValueChange={(nextValue) => commit(nextValue, routes)}
            ledgerEntries={ledgerEntries}
            insertMode="bare"
            disabled={disabled}
          />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('workflows.branching.switchFieldHint', 'The context path this step switches on. Each case compares it for equality.')}
        </p>
      </div>

      {duplicates.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            {t(
              'workflows.branching.duplicateCases',
              'Duplicate case value(s): {values}. Only the highest-priority route can ever match.',
              { values: duplicates.join(', ') },
            )}
          </AlertDescription>
        </Alert>
      )}

      {routes.length === 0 && <EmptyRoutesAlert />}
      {routes.length === 1 && <SingleRouteAlert />}

      {routes.map((route) => (
        <div key={route.transitionId} className="rounded-md border border-border p-3">
          <RouteHeader route={route} disabled={disabled} onMakeOtherwise={() => makeOtherwise(route.transitionId)} />

          {route.kind === 'otherwise' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                'workflows.branching.otherwiseRequired',
                'A Switch always keeps one otherwise route so an unmatched value cannot stall the workflow.',
              )}
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${id}-${route.transitionId}-label`} className="mb-1 text-xs font-medium">
                  {t('workflows.branching.caseLabelField', 'Label')}
                </Label>
                <Input
                  id={`${id}-${route.transitionId}-label`}
                  type="text"
                  value={route.caseLabel ?? ''}
                  onChange={(event) => updateRoute(route.transitionId, { caseLabel: event.target.value })}
                  className="text-xs"
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor={`${id}-${route.transitionId}-value`} className="mb-1 text-xs font-medium">
                  {t('workflows.branching.caseValueField', 'Value')}
                </Label>
                <Input
                  id={`${id}-${route.transitionId}-value`}
                  type="text"
                  value={route.caseValue ?? ''}
                  onChange={(event) => updateRoute(route.transitionId, { caseValue: event.target.value, mode: 'inline' })}
                  className="font-mono text-xs"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
