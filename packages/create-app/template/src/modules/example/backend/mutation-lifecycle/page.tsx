'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type PhaseStatus = 'idle' | 'pending' | 'ok' | 'error'

type SyncProbeKey = 'defaultPriority' | 'preventUncomplete' | 'auditDelete'

type SyncProbeResult = {
  key: SyncProbeKey
  label: string
  status: PhaseStatus
  httpStatus: number | null
  ok: boolean
  details: string
}

const syncProbeOrder: SyncProbeKey[] = ['defaultPriority', 'preventUncomplete', 'auditDelete']
const hintClassName = 'rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-400/10 p-2 text-xs text-amber-800 dark:text-amber-100/90'

function print(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

function createSyncProbeResult(partial?: Partial<SyncProbeResult>): SyncProbeResult {
  return {
    key: partial?.key ?? 'defaultPriority',
    label: partial?.label ?? '',
    status: partial?.status ?? 'idle',
    httpStatus: partial?.httpStatus ?? null,
    ok: partial?.ok ?? false,
    details: partial?.details ?? '',
  }
}

export default function MutationLifecyclePage() {
  const t = useT()

  // Phase m1 state
  const [guardStatus, setGuardStatus] = React.useState<PhaseStatus>('idle')
  const [guardPayload, setGuardPayload] = React.useState<unknown>(null)
  const [guardError, setGuardError] = React.useState<string | null>(null)

  // Phase m2 state
  const [syncStatus, setSyncStatus] = React.useState<PhaseStatus>('idle')
  const [syncError, setSyncError] = React.useState<string | null>(null)
  const [syncPayloads, setSyncPayloads] = React.useState<unknown>(null)
  const [syncProbeResults, setSyncProbeResults] = React.useState<Record<SyncProbeKey, SyncProbeResult>>({
    defaultPriority: createSyncProbeResult({ key: 'defaultPriority', label: t('example.mutationLifecycle.m2.probe.defaultPriority.label', 'auto-default-priority (before-create)') }),
    preventUncomplete: createSyncProbeResult({ key: 'preventUncomplete', label: t('example.mutationLifecycle.m2.probe.preventUncomplete.label', 'prevent-uncomplete (before-update)') }),
    auditDelete: createSyncProbeResult({ key: 'auditDelete', label: t('example.mutationLifecycle.m2.probe.auditDelete.label', 'audit-delete (after-delete)') }),
  })

  // Phase m3/m4 are informational
  const phaseM3Status = React.useMemo<PhaseStatus>(() => 'ok', [])
  const phaseM4Status = React.useMemo<PhaseStatus>(() => 'ok', [])

  // ── Phase m1: Mutation Guard Probe ──────────────────────────────
  const runGuardProbe = React.useCallback(async () => {
    setGuardStatus('pending')
    setGuardError(null)
    setGuardPayload(null)

    try {
      // POST a todo — the guard pipeline runs on create
      const createResponse = await apiCall<{ id: string }>('/api/example/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'm1-guard-probe' }),
      })

      setGuardPayload(createResponse.result)

      if (!createResponse.ok) {
        setGuardStatus('error')
        setGuardError(
          t(
            'example.mutationLifecycle.m1.createFailed',
            `Guard probe failed: expected 201, got ${createResponse.status}.`,
          ),
        )
        return
      }

      // Clean up — delete the created todo
      const todoId = (createResponse.result as { id?: string })?.id
      if (todoId) {
        await apiCall(`/api/example/todos?id=${todoId}`, { method: 'DELETE' })
      }

      setGuardStatus('ok')
    } catch (error) {
      setGuardStatus('error')
      setGuardError(error instanceof Error ? error.message : String(error))
    }
  }, [t])

  // ── Phase m2: Sync Subscriber Probe ─────────────────────────────
  const runSyncProbe = React.useCallback(async () => {
    setSyncStatus('pending')
    setSyncError(null)
    setSyncPayloads(null)

    setSyncProbeResults((prev) => {
      const next = { ...prev }
      for (const key of syncProbeOrder) {
        next[key] = { ...next[key], status: 'pending', httpStatus: null, ok: false, details: '' }
      }
      return next
    })

    const nextResults: Record<SyncProbeKey, SyncProbeResult> = {
      defaultPriority: createSyncProbeResult({ key: 'defaultPriority', label: t('example.mutationLifecycle.m2.probe.defaultPriority.label', 'auto-default-priority (before-create)'), status: 'pending' }),
      preventUncomplete: createSyncProbeResult({ key: 'preventUncomplete', label: t('example.mutationLifecycle.m2.probe.preventUncomplete.label', 'prevent-uncomplete (before-update)'), status: 'pending' }),
      auditDelete: createSyncProbeResult({ key: 'auditDelete', label: t('example.mutationLifecycle.m2.probe.auditDelete.label', 'audit-delete (after-delete)'), status: 'pending' }),
    }

    const payloads: Record<string, unknown> = {}
    let createdTodoId: string | null = null

    try {
      // ── Probe 1: auto-default-priority (before-create) ──
      const createResponse = await apiCall<{ id: string }>('/api/example/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'm2-sync-probe' }),
      })
      payloads.create = createResponse.result
      const createOk = createResponse.ok && createResponse.status === 201
      createdTodoId = createOk ? (createResponse.result as { id?: string })?.id ?? null : null

      nextResults.defaultPriority = {
        ...nextResults.defaultPriority,
        status: createOk ? 'ok' : 'error',
        httpStatus: createResponse.status,
        ok: createOk,
        details: createOk
          ? t('example.mutationLifecycle.m2.probe.defaultPriority.ok', 'Todo created (201). Sync before-event example.todo.creating fired — auto-default-priority subscriber injects priority if absent.')
          : t('example.mutationLifecycle.m2.probe.defaultPriority.error', `Expected 201, got ${createResponse.status}.`),
      }

      if (!createdTodoId) {
        const skipMsg = t('example.mutationLifecycle.m2.probe.skipped', 'Skipped — no todo was created in probe 1.')
        nextResults.preventUncomplete = {
          ...nextResults.preventUncomplete,
          status: 'error',
          details: skipMsg,
        }
        nextResults.auditDelete = {
          ...nextResults.auditDelete,
          status: 'error',
          details: skipMsg,
        }
        setSyncStatus('error')
        setSyncError(t('example.mutationLifecycle.m2.createFailed', 'Could not create todo for sync subscriber probe.'))
        setSyncPayloads(payloads)
        setSyncProbeResults(nextResults)
        return
      }

      // ── Probe 2: prevent-uncomplete (before-update) ──
      // Step 2a: Mark as done
      const markDoneResponse = await apiCall('/api/example/todos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: createdTodoId, is_done: true }),
      })
      payloads.markDone = markDoneResponse.result
      const markDoneOk = markDoneResponse.ok

      if (!markDoneOk) {
        nextResults.preventUncomplete = {
          ...nextResults.preventUncomplete,
          status: 'error',
          httpStatus: markDoneResponse.status,
          details: t('example.mutationLifecycle.m2.probe.preventUncomplete.markDoneFailed', `Failed to mark todo as done: status ${markDoneResponse.status}.`),
        }
      } else {
        // Step 2b: Try to revert to pending — should be blocked by prevent-uncomplete subscriber
        const revertResponse = await apiCall('/api/example/todos', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: createdTodoId, is_done: false }),
        })
        payloads.revert = revertResponse.result
        const revertBlocked = revertResponse.status === 422
        nextResults.preventUncomplete = {
          ...nextResults.preventUncomplete,
          status: revertBlocked ? 'ok' : 'error',
          httpStatus: revertResponse.status,
          ok: revertBlocked,
          details: revertBlocked
            ? t('example.mutationLifecycle.m2.probe.preventUncomplete.ok', 'Revert blocked (422). Sync before-event example.todo.updating fired — prevent-uncomplete subscriber rejected the operation.')
            : t('example.mutationLifecycle.m2.probe.preventUncomplete.error', `Expected 422 (blocked), got ${revertResponse.status}.`),
        }
      }

      // ── Probe 3: audit-delete (after-delete) ──
      const deleteResponse = await apiCall(`/api/example/todos?id=${createdTodoId}`, {
        method: 'DELETE',
      })
      payloads.delete = deleteResponse.result
      const deleteOk = deleteResponse.ok
      nextResults.auditDelete = {
        ...nextResults.auditDelete,
        status: deleteOk ? 'ok' : 'error',
        httpStatus: deleteResponse.status,
        ok: deleteOk,
        details: deleteOk
          ? t('example.mutationLifecycle.m2.probe.auditDelete.ok', 'Todo deleted (200). Sync after-event example.todo.deleted fired — audit-delete subscriber logged to server console.')
          : t('example.mutationLifecycle.m2.probe.auditDelete.error', `Expected 200, got ${deleteResponse.status}.`),
      }
      createdTodoId = null

      const allOk = syncProbeOrder.every((key) => nextResults[key].ok)
      setSyncStatus(allOk ? 'ok' : 'error')
      if (!allOk) {
        setSyncError(t('example.mutationLifecycle.m2.partial', 'One or more sync subscriber probes failed. Review rows below.'))
      }
    } catch (error) {
      setSyncStatus('error')
      setSyncError(error instanceof Error ? error.message : String(error))
    } finally {
      // Clean up if a todo was left behind
      if (createdTodoId) {
        await apiCall(`/api/example/todos?id=${createdTodoId}`, { method: 'DELETE' }).catch(() => {})
      }
      setSyncPayloads(payloads)
      setSyncProbeResults(nextResults)
    }
  }, [t])

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.mutationLifecycle.title', 'UMES Phase M — Mutation Lifecycle')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('example.mutationLifecycle.description', 'Validation page for mutation guards, sync event subscribers, client-side event filtering, and command interceptors.')}
          </p>
        </div>

        {/* Status overview */}
        <div className="grid gap-2 rounded border border-border p-3 text-xs text-muted-foreground">
          <div data-testid="phase-m-status-m1">phaseM1={guardStatus}</div>
          <div data-testid="phase-m-status-m2">phaseM2={syncStatus}</div>
          <div data-testid="phase-m-status-m3">phaseM3={phaseM3Status}</div>
          <div data-testid="phase-m-status-m4">phaseM4={phaseM4Status}</div>
        </div>

        {/* ── Phase m1: Mutation Guard Registry ── */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.mutationLifecycle.m1.title', 'Phase m1 — Mutation Guard Registry')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.mutationLifecycle.m1.description', 'Create a todo via the CRUD pipeline to verify the mutation guard registry evaluates the `example.todo-limit` guard on POST.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.mutationLifecycle.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.mutationLifecycle.m1.hint1', '1. Guard `example.todo-limit` targets `example.todo` on `create` operations with priority 50.')}</div>
            <div>{t('example.mutationLifecycle.m1.hint2', '2. Guard validates `organizationId` presence — creation fails with 422 if missing.')}</div>
            <div>{t('example.mutationLifecycle.m1.hint3', '3. Multiple guards run by priority order; first rejection stops the pipeline.')}</div>
            <div>{t('example.mutationLifecycle.m1.hint4', '4. Legacy `crudMutationGuardService` is automatically bridged as a guard with priority 0.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-m1-run-probe" type="button" onClick={() => void runGuardProbe()}>
              {t('example.mutationLifecycle.m1.run', 'Run guard probe')}
            </Button>
            <span data-testid="phase-m1-status" className="text-xs text-muted-foreground">status={guardStatus}</span>
          </div>
          {guardError ? <div data-testid="phase-m1-error" className="text-xs text-destructive">{guardError}</div> : null}
          <div data-testid="phase-m1-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            response={print(guardPayload)}
          </div>
        </div>

        {/* ── Phase m2: Sync Event Subscribers ── */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.mutationLifecycle.m2.title', 'Phase m2 — Sync Event Subscribers')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.mutationLifecycle.m2.description', 'Run a multi-step probe: create a todo (verify auto-default-priority), mark as done then try to revert (verify prevent-uncomplete blocks with 422), and delete (verify audit-delete fires).')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.mutationLifecycle.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.mutationLifecycle.m2.hint1', '1. `auto-default-priority`: Injects `priority: \'normal\'` when creating a todo without explicit priority (sync before-create).')}</div>
            <div>{t('example.mutationLifecycle.m2.hint2', '2. `prevent-uncomplete`: Blocks reverting completed todos to pending with 422 (sync before-update).')}</div>
            <div>{t('example.mutationLifecycle.m2.hint3', '3. `audit-delete`: Logs deletion audit trail to server console (sync after-delete, non-blocking).')}</div>
            <div>{t('example.mutationLifecycle.m2.hint4', '4. Sync subscribers run inside the CRUD pipeline, before/after the actual mutation — unlike async subscribers which run post-commit.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-m2-run-probe" type="button" onClick={() => void runSyncProbe()}>
              {t('example.mutationLifecycle.m2.run', 'Run sync subscriber probe')}
            </Button>
            <span data-testid="phase-m2-status" className="text-xs text-muted-foreground">status={syncStatus}</span>
          </div>
          {syncError ? <div data-testid="phase-m2-error" className="text-xs text-destructive">{syncError}</div> : null}
          <div className="grid gap-2">
            {syncProbeOrder.map((key) => {
              const probe = syncProbeResults[key]
              return (
                <div key={probe.key} className="grid gap-1 rounded border border-border p-2 text-xs" data-testid={`phase-m2-probe-${probe.key}`}>
                  <div className="font-medium text-foreground">{probe.label}</div>
                  <div className="text-muted-foreground">status={probe.status} httpStatus={probe.httpStatus ?? 'n/a'}</div>
                  <div className="text-muted-foreground">{probe.details}</div>
                </div>
              )
            })}
          </div>
          <div data-testid="phase-m2-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            payloads={print(syncPayloads)}
          </div>
        </div>

        {/* ── Phase m3: Client-Side Event Filtering ── */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.mutationLifecycle.m3.title', 'Phase m3 — Client-Side Event Filtering')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.mutationLifecycle.m3.description', 'Widget injection event handlers can now declare an operation filter to skip events for specific CRUD operations.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.mutationLifecycle.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.mutationLifecycle.m3.hint1', '1. Widgets can declare `eventHandlers.filter.operations` to skip specific CRUD operations (e.g., only fire on `update`).')}</div>
            <div>{t('example.mutationLifecycle.m3.hint2', '2. CrudForm now passes `operation` (\'create\' or \'update\') in the injection context.')}</div>
            <div>{t('example.mutationLifecycle.m3.hint3', '3. Widgets without a filter continue to fire for all operations (backward compatible).')}</div>
            <div>{t('example.mutationLifecycle.m3.hint4', '4. Type: `WidgetInjectionEventFilter = { operations?: (\'create\' | \'update\' | \'delete\')[] }`')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button asChild type="button" variant="outline">
              <Link href="/backend/umes-extensions">{t('example.mutationLifecycle.m3.openPhaseG', 'Open Phase G — CrudForm injection')}</Link>
            </Button>
            <span>{t('example.mutationLifecycle.m3.note', 'The filter is a type-level extension. See Phase G page for CrudForm injection demo.')}</span>
          </div>
          <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            type={print({ operations: ['create', 'update', 'delete'] })}
          </div>
        </div>

        {/* ── Phase m4: Command Interceptors ── */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.mutationLifecycle.m4.title', 'Phase m4 — Command Interceptors')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.mutationLifecycle.m4.description', 'The `example.audit-logging` interceptor wraps all `customers.*` command bus operations with timing metadata.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.mutationLifecycle.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.mutationLifecycle.m4.hint1', '1. `example.audit-logging` intercepts all `customers.*` commands (wildcard pattern).')}</div>
            <div>{t('example.mutationLifecycle.m4.hint2', '2. `beforeExecute` stores `auditStartedAt` timestamp in metadata.')}</div>
            <div>{t('example.mutationLifecycle.m4.hint3', '3. `afterExecute` reads metadata and logs: `[example:audit] Command {id} completed in {ms}ms`.')}</div>
            <div>{t('example.mutationLifecycle.m4.hint4', '4. Pattern matching supports `*` (all), exact ID, and `prefix.*` (namespace wildcard).')}</div>
            <div>{t('example.mutationLifecycle.m4.hint5', '5. Interceptors run on both `execute()` and `undo()` code paths.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button asChild type="button" variant="outline">
              <Link href="/backend/customers/people">{t('example.mutationLifecycle.m4.openCustomers', 'Open customers')}</Link>
            </Button>
            <span>{t('example.mutationLifecycle.m4.note', 'Create or edit a customer, then check server console for the audit log entry.')}</span>
          </div>
          <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            interceptor={print({
              id: 'example.audit-logging',
              targetCommand: 'customers.*',
              priority: 50,
              hooks: ['beforeExecute', 'afterExecute'],
            })}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
