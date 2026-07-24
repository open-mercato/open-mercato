"use client"

import * as React from 'react'
import { Play, ShieldCheck } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ApprovedCase = {
  id: string
  processType: string | null
}

export type RunEvaluationDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  agentLabel: string
  onStarted: () => void
}

const ALL_CASES = '__all__'
const FORM_ID = 'agent-orchestrator-run-evaluation-form'

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * Triggers an evaluation run (`POST /eval-runs`) for the host agent against its
 * approved eval cases. Eval runs are `source=eval`: they replay fresh inference
 * under the agent's own principal, propose-only, and never touch production
 * metrics or caseload.
 */
export function RunEvaluationDrawer({ open, onOpenChange, agentId, agentLabel, onStarted }: RunEvaluationDrawerProps) {
  const t = useT()
  const [cases, setCases] = React.useState<ApprovedCase[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [selection, setSelection] = React.useState<string>(ALL_CASES)
  const [repeatCount, setRepeatCount] = React.useState(1)
  const [judgeMayGate, setJudgeMayGate] = React.useState(false)
  const [isBusy, setIsBusy] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.agentDetail.runEvaluation',
    blockedMessage: t('agent_orchestrator.evalCases.flash.actionError'),
  })

  React.useEffect(() => {
    if (!open) return
    setSelection(ALL_CASES)
    setRepeatCount(1)
    setJudgeMayGate(false)
    let cancelled = false
    setIsLoading(true)
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/eval-cases?agentDefinitionId=${encodeURIComponent(agentId)}&status=approved&pageSize=100`,
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setCases(
        items
          .map((item): ApprovedCase | null => {
            const id = readString(item, 'id')
            if (!id) return null
            return { id, processType: readString(item, 'process_type', 'processType') || null }
          })
          .filter((row): row is ApprovedCase => !!row),
      )
      setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [open, agentId])

  const submit = React.useCallback(async () => {
    const evalCaseIds = selection === ALL_CASES ? cases.map((row) => row.id) : [selection]
    if (evalCaseIds.length === 0) {
      flash(t('agent_orchestrator.agentDetail.evaluation.run.noApproved', 'This agent has no approved cases to evaluate.'), 'error')
      return
    }
    setIsBusy(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow<{ suiteRunId?: string }>(
            '/api/agent_orchestrator/eval-runs',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                agentDefinitionId: agentId,
                evalCaseIds,
                repeatCount,
                judgeMayGate,
              }),
            },
          ),
        context: { retryLastMutation },
      })
      flash(t('agent_orchestrator.agentDetail.evaluation.run.started', 'Evaluation started.'), 'success')
      onOpenChange(false)
      onStarted()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.evalCases.flash.actionError'), 'error')
    } finally {
      setIsBusy(false)
    }
  }, [selection, cases, agentId, repeatCount, judgeMayGate, runMutation, retryLastMutation, onOpenChange, onStarted, t])

  const noApproved = !isLoading && cases.length === 0

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="max-w-lg">
        <DrawerHeader leading={<Play className="size-5" />}>
          <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
            {t('agent_orchestrator.agentDetail.evaluation.section.runs', 'Runs')}
          </span>
          <DrawerTitle>{t('agent_orchestrator.agentDetail.evaluation.run.title', 'Run evaluation')}</DrawerTitle>
          <DrawerDescription>{agentLabel || agentId}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="space-y-5 pb-6">
          <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              {t(
                'agent_orchestrator.agentDetail.evaluation.run.sourceNote',
                'Eval runs are source=eval — fresh, propose-only inference that never touches production metrics or caseload.',
              )}
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t('agent_orchestrator.agentDetail.evaluation.run.loadingCases', 'Loading approved cases…')}
            </div>
          ) : noApproved ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t('agent_orchestrator.agentDetail.evaluation.run.noApproved', 'This agent has no approved cases to evaluate.')}
            </p>
          ) : (
            <form
              id={FORM_ID}
              className="space-y-5"
              onSubmit={(event) => { event.preventDefault(); void submit() }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="run-eval-case-set">
                  {t('agent_orchestrator.agentDetail.evaluation.run.caseSet', 'Case set')}
                </Label>
                <Select value={selection} onValueChange={setSelection}>
                  <SelectTrigger id="run-eval-case-set">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CASES}>
                      {t('agent_orchestrator.agentDetail.evaluation.run.allApproved', 'All approved cases ({count})', { count: cases.length })}
                    </SelectItem>
                    {cases.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.processType ? `${row.processType} · ${row.id.slice(0, 8)}` : row.id.slice(0, 12)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="run-eval-repeat">
                  {t('agent_orchestrator.agentDetail.evaluation.run.repeatCount', 'Repeat count')}
                </Label>
                <Input
                  id="run-eval-repeat"
                  type="number"
                  min={1}
                  max={20}
                  value={repeatCount}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setRepeatCount(Number.isFinite(next) ? Math.min(20, Math.max(1, Math.round(next))) : 1)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t('agent_orchestrator.agentDetail.evaluation.run.repeatHint', 'Replay each case this many times to measure model/judge variance.')}
                </p>
              </div>

              <SwitchField
                checked={judgeMayGate}
                onCheckedChange={setJudgeMayGate}
                label={t('agent_orchestrator.agentDetail.evaluation.run.judgeGate', 'Let LLM judges gate')}
                description={t(
                  'agent_orchestrator.agentDetail.evaluation.run.judgeGateHint',
                  'When on, rubric verdicts from LLM-judge assertions may decide pass/fail for this run.',
                )}
              />
            </form>
          )}
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              {t('agent_orchestrator.proposal.actions.cancelEdit', 'Cancel')}
            </Button>
          </DrawerClose>
          <Button type="submit" form={FORM_ID} disabled={isBusy || isLoading || noApproved}>
            {isBusy ? <Spinner className="size-4" /> : <Play className="size-4" />}
            {t('agent_orchestrator.agentDetail.evaluation.run.submit', 'Run evaluation')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default RunEvaluationDrawer
