"use client"

import * as React from 'react'
import { z } from 'zod'
import { Archive, Check } from 'lucide-react'
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
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../../components/types'

type EvalCaseStatus = 'draft' | 'approved' | 'archived'
type EvalCaseSourceType = 'correction' | 'golden_run'

const STATUS_TONE: StatusMap<EvalCaseStatus> = {
  draft: 'info',
  approved: 'success',
  archived: 'neutral',
}

type EvalCaseDetail = {
  id: string
  status: EvalCaseStatus
  sourceType: EvalCaseSourceType
  sourceId: string
  agentDefinitionId: string
  processType: string | null
  input: unknown
  expected: unknown
  approvedByUserId: string | null
  createdAt: string | null
  updatedAt: string | null
}

type CaseFormValues = {
  agentDefinitionId: string
  processType?: string
  input: string
  expected?: string
}

export type EvalCaseDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `view` opens an existing case by id; `create` shows the authoring form. */
  mode: 'view' | 'create'
  caseId: string | null
  agentId: string
  agentLabel: string
  onChanged: () => void
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapDetail(record: Record<string, unknown>): EvalCaseDetail | null {
  const id = readString(record, 'id')
  if (!id) return null
  const statusRaw = readString(record, 'status')
  const sourceTypeRaw = readString(record, 'source_type', 'sourceType')
  return {
    id,
    status: statusRaw === 'approved' ? 'approved' : statusRaw === 'archived' ? 'archived' : 'draft',
    sourceType: sourceTypeRaw === 'correction' ? 'correction' : 'golden_run',
    sourceId: readString(record, 'source_id', 'sourceId'),
    agentDefinitionId: readString(record, 'agent_definition_id', 'agentDefinitionId'),
    processType: readString(record, 'process_type', 'processType') || null,
    input: record.input ?? null,
    expected: record.expected ?? null,
    approvedByUserId: readString(record, 'approved_by_user_id', 'approvedByUserId') || null,
    createdAt: readString(record, 'created_at', 'createdAt') || null,
    updatedAt: readString(record, 'updated_at', 'updatedAt') || null,
  }
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  )
}

/**
 * Per-agent eval-case drawer. In `view` mode it fetches the full case
 * (`GET /eval-cases/{id}` — input/expected are encrypted and only returned by
 * that route) and offers Approve/Archive; in `create` mode it authors a new case
 * with the agent prefilled to the host agent.
 */
export function EvalCaseDrawer({ open, onOpenChange, mode, caseId, agentId, agentLabel, onChanged }: EvalCaseDrawerProps) {
  const t = useT()
  const locale = useLocale()
  const [detail, setDetail] = React.useState<EvalCaseDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isBusy, setIsBusy] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.agentDetail.evalCase',
    blockedMessage: t('agent_orchestrator.evalCases.flash.actionError'),
  })

  const loadGenerationRef = React.useRef(0)

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!caseId) return
    const generation = ++loadGenerationRef.current
    if (!opts?.silent) setIsLoading(true)
    const call = await apiCall<Record<string, unknown>>(
      `/api/agent_orchestrator/eval-cases/${encodeURIComponent(caseId)}`,
      undefined,
      { fallback: {} },
    )
    if (generation !== loadGenerationRef.current) return
    setDetail(call.ok && call.result ? mapDetail(call.result) : null)
    setIsLoading(false)
  }, [caseId])

  React.useEffect(() => {
    if (!open || mode !== 'view' || !caseId) {
      setDetail(null)
      return
    }
    void load()
  }, [open, mode, caseId, load])

  const changeStatus = React.useCallback(async (action: 'approve' | 'archive') => {
    if (!detail) return
    setIsBusy(true)
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(detail.updatedAt),
            () => apiCallOrThrow(
              `/api/agent_orchestrator/eval-cases/${encodeURIComponent(detail.id)}/${action}`,
              { method: 'POST' },
            ),
          ),
        context: { retryLastMutation },
      })
      flash(
        t(action === 'approve' ? 'agent_orchestrator.evalCases.flash.approved' : 'agent_orchestrator.evalCases.flash.archived'),
        'success',
      )
      await load({ silent: true })
      onChanged()
    } catch (err) {
      if (!surfaceRecordConflict(err, t)) flash(t('agent_orchestrator.evalCases.flash.actionError'), 'error')
    } finally {
      setIsBusy(false)
    }
  }, [detail, runMutation, retryLastMutation, load, onChanged, t])

  const createSchema = React.useMemo(
    () =>
      z.object({
        agentDefinitionId: z.string().min(1, 'agent_orchestrator.evalCases.form.errors.agentRequired'),
        processType: z.string().optional(),
        input: z.string().min(1, 'agent_orchestrator.evalCases.form.errors.inputRequired'),
        expected: z.string().optional(),
      }),
    [],
  )

  const agentOptions = React.useMemo<CrudFieldOption[]>(
    () => [{ value: agentId, label: agentLabel || agentId }],
    [agentId, agentLabel],
  )

  const createFields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'agentDefinitionId',
        label: t('agent_orchestrator.evalCases.form.agent'),
        type: 'combobox',
        options: agentOptions,
        seedOptions: agentOptions,
        allowCustomValues: true,
        required: true,
      },
      {
        id: 'processType',
        label: t('agent_orchestrator.evalCases.form.processType'),
        type: 'text',
        description: t('agent_orchestrator.evalCases.form.processTypeHint'),
      },
      {
        id: 'input',
        label: t('agent_orchestrator.evalCases.form.input'),
        type: 'textarea',
        description: t('agent_orchestrator.evalCases.form.jsonHint'),
        required: true,
      },
      {
        id: 'expected',
        label: t('agent_orchestrator.evalCases.form.expected'),
        type: 'textarea',
        description: t('agent_orchestrator.evalCases.form.jsonHint'),
      },
    ],
    [t, agentOptions],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="max-w-xl">
        <DrawerHeader>
          <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
            {t('agent_orchestrator.agentDetail.evaluation.section.cases', 'Cases')}
          </span>
          <DrawerTitle>
            {mode === 'create'
              ? t('agent_orchestrator.evalCases.form.createTitle')
              : t('agent_orchestrator.agentDetail.evaluation.cases.viewTitle', 'Evaluation case')}
          </DrawerTitle>
          <DrawerDescription>{agentLabel || agentId}</DrawerDescription>
        </DrawerHeader>

        {mode === 'create' ? (
          <DrawerBody className="pb-6">
            <CrudForm<CaseFormValues>
              embedded
              fields={createFields}
              initialValues={{ agentDefinitionId: agentId, input: '' }}
              entityIds={['agent_orchestrator:agent_eval_case']}
              schema={createSchema}
              submitLabel={t('agent_orchestrator.evalCases.form.submit')}
              onSubmit={async (values) => {
                let parsedInput: unknown
                try {
                  parsedInput = JSON.parse(values.input)
                } catch {
                  const message = t('agent_orchestrator.evalCases.form.errors.inputJson')
                  throw createCrudFormError(message, { input: message })
                }
                let parsedExpected: unknown
                const expectedRaw = values.expected?.trim() ?? ''
                if (expectedRaw) {
                  try {
                    parsedExpected = JSON.parse(expectedRaw)
                  } catch {
                    const message = t('agent_orchestrator.evalCases.form.errors.expectedJson')
                    throw createCrudFormError(message, { expected: message })
                  }
                }
                const processType = values.processType?.trim() ?? ''
                await createCrud('agent_orchestrator/eval-cases', {
                  agentDefinitionId: values.agentDefinitionId,
                  input: parsedInput,
                  expected: expectedRaw ? parsedExpected : undefined,
                  processType: processType || undefined,
                })
                flash(t('agent_orchestrator.evalCases.flash.created'), 'success')
                onOpenChange(false)
                onChanged()
              }}
            />
          </DrawerBody>
        ) : (
          <>
            <DrawerBody className="space-y-5 pb-6">
              {isLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  {t('agent_orchestrator.agentDetail.evaluation.cases.loading', 'Loading case…')}
                </div>
              ) : !detail ? (
                <p className="py-6 text-sm text-muted-foreground">
                  {t('agent_orchestrator.agentDetail.evaluation.cases.loadError', 'Could not load this case.')}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={STATUS_TONE[detail.status]} dot>
                      {t(`agent_orchestrator.evalCases.status.${detail.status}`)}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        detail.sourceType === 'correction'
                          ? 'agent_orchestrator.evalCases.sourceType.correction'
                          : 'agent_orchestrator.evalCases.sourceType.goldenRun',
                      )}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{detail.id}</span>
                  </div>

                  <section className="space-y-2">
                    <SectionHeader title={t('agent_orchestrator.evalCases.detail.input')} />
                    {detail.input == null ? (
                      <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalCases.detail.noPayload')}</p>
                    ) : (
                      <JsonDisplay data={detail.input} maxHeight="16rem" />
                    )}
                  </section>

                  <section className="space-y-2">
                    <SectionHeader title={t('agent_orchestrator.evalCases.detail.expected')} />
                    {detail.expected == null ? (
                      <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalCases.detail.noPayload')}</p>
                    ) : (
                      <JsonDisplay data={detail.expected} maxHeight="16rem" />
                    )}
                  </section>

                  <section className="space-y-2">
                    <SectionHeader title={t('agent_orchestrator.agentDetail.evaluation.cases.provenance', 'Provenance')} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetaRow
                        label={t('agent_orchestrator.evalCases.col.sourceType')}
                        value={t(
                          detail.sourceType === 'correction'
                            ? 'agent_orchestrator.evalCases.sourceType.correction'
                            : 'agent_orchestrator.evalCases.sourceType.goldenRun',
                        )}
                      />
                      <MetaRow
                        label={t('agent_orchestrator.evalCases.col.sourceId')}
                        value={<span className="font-mono text-xs">{detail.sourceId || '—'}</span>}
                      />
                      <MetaRow
                        label={t('agent_orchestrator.evalCases.detail.processType')}
                        value={<span className="font-mono text-xs">{detail.processType ?? '—'}</span>}
                      />
                      <MetaRow
                        label={t('agent_orchestrator.evalCases.detail.approvedBy')}
                        value={<span className="font-mono text-xs">{detail.approvedByUserId ?? '—'}</span>}
                      />
                      <MetaRow
                        label={t('agent_orchestrator.evalCases.col.created')}
                        value={formatDateTime(detail.createdAt, locale) ?? '—'}
                      />
                      <MetaRow
                        label={t('agent_orchestrator.evalCases.detail.updated')}
                        value={formatDateTime(detail.updatedAt, locale) ?? '—'}
                      />
                    </div>
                  </section>
                </>
              )}
            </DrawerBody>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button type="button" variant="outline">
                  {t('agent_orchestrator.evalCases.detail.back')}
                </Button>
              </DrawerClose>
              {detail && detail.status === 'draft' ? (
                <Button type="button" size="default" disabled={isBusy} onClick={() => { void changeStatus('approve') }}>
                  <Check className="size-4" />
                  {t('agent_orchestrator.evalCases.actions.approve')}
                </Button>
              ) : null}
              {detail && (detail.status === 'draft' || detail.status === 'approved') ? (
                <Button type="button" variant="outline" disabled={isBusy} onClick={() => { void changeStatus('archive') }}>
                  <Archive className="size-4" />
                  {t('agent_orchestrator.evalCases.actions.archive')}
                </Button>
              ) : null}
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

export default EvalCaseDrawer
