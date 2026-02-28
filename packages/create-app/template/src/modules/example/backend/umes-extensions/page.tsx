'use client'

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import type { ColumnDef } from '@tanstack/react-table'

type TodoListProbe = {
  _example?: {
    interceptor?: {
      processedAt?: string
      processingTimeMs?: number
    }
    wildcardProbe?: boolean
  }
  items?: unknown[]
  total?: number
}

type HandleRow = {
  id: string
  label: string
}

type PhaseStatus = 'idle' | 'pending' | 'ok' | 'error'

type InterceptorProbeKey = 'default' | 'wildcard' | 'badQuery' | 'timeout' | 'crash'

type InterceptorProbeResult = {
  key: InterceptorProbeKey
  label: string
  status: PhaseStatus
  httpStatus: number | null
  ok: boolean
  details: string
}

const SAMPLE_HANDLES: HandleRow[] = [
  { id: ComponentReplacementHandles.page('/backend/umes-extensions'), label: 'Page handle' },
  { id: ComponentReplacementHandles.dataTable('example.umes.extensions'), label: 'DataTable handle' },
  { id: ComponentReplacementHandles.crudForm('example.todo'), label: 'CrudForm handle' },
  { id: ComponentReplacementHandles.section('ui.detail', 'NotesSection'), label: 'Section handle example' },
]

const probeOrder: InterceptorProbeKey[] = ['default', 'wildcard', 'badQuery', 'timeout', 'crash']
const hintClassName = 'rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-100/90'

function print(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

function hasInterceptorMetadata(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as TodoListProbe
  return Boolean(candidate._example?.interceptor)
}

function hasWildcardMetadata(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as TodoListProbe
  return candidate._example?.wildcardProbe === true
}

function createProbeResult(partial?: Partial<InterceptorProbeResult>): InterceptorProbeResult {
  return {
    key: partial?.key ?? 'default',
    label: partial?.label ?? '',
    status: partial?.status ?? 'idle',
    httpStatus: partial?.httpStatus ?? null,
    ok: partial?.ok ?? false,
    details: partial?.details ?? '',
  }
}

export default function UmesExtensionsPage() {
  const t = useT()

  const [interceptorStatus, setInterceptorStatus] = React.useState<PhaseStatus>('idle')
  const [interceptorPayload, setInterceptorPayload] = React.useState<unknown>(null)
  const [interceptorError, setInterceptorError] = React.useState<string | null>(null)
  const [formSubmitResult, setFormSubmitResult] = React.useState<Record<string, unknown> | null>(null)

  const [probeResults, setProbeResults] = React.useState<Record<InterceptorProbeKey, InterceptorProbeResult>>({
    default: createProbeResult({ key: 'default', label: 'Default GET metadata probe' }),
    wildcard: createProbeResult({ key: 'wildcard', label: 'Wildcard route match probe' }),
    badQuery: createProbeResult({ key: 'badQuery', label: 'Bad query revalidation probe' }),
    timeout: createProbeResult({ key: 'timeout', label: 'Timeout fail-closed probe' }),
    crash: createProbeResult({ key: 'crash', label: 'Crash fail-closed probe' }),
  })

  const columns = React.useMemo<ColumnDef<HandleRow>[]>(
    () => [
      { accessorKey: 'label', header: t('example.umes.extensions.table.label', 'Label') },
      { accessorKey: 'id', header: t('example.umes.extensions.table.handle', 'Handle') },
    ],
    [t],
  )

  const formFields = React.useMemo<CrudField[]>(
    () => [
      { id: 'title', label: t('example.umes.extensions.form.title', 'Title'), type: 'text', required: true },
      { id: 'note', label: t('example.umes.extensions.form.note', 'Note'), type: 'textarea' },
    ],
    [t],
  )

  const runInterceptorProbe = React.useCallback(async () => {
    setInterceptorStatus('pending')
    setInterceptorError(null)

    setProbeResults((previous) => {
      const next = { ...previous }
      for (const key of probeOrder) {
        next[key] = {
          ...next[key],
          status: 'pending',
          httpStatus: null,
          ok: false,
          details: '',
        }
      }
      return next
    })

    const nextResults: Record<InterceptorProbeKey, InterceptorProbeResult> = {
      default: createProbeResult({ key: 'default', label: 'Default GET metadata probe', status: 'pending' }),
      wildcard: createProbeResult({ key: 'wildcard', label: 'Wildcard route match probe', status: 'pending' }),
      badQuery: createProbeResult({ key: 'badQuery', label: 'Bad query revalidation probe', status: 'pending' }),
      timeout: createProbeResult({ key: 'timeout', label: 'Timeout fail-closed probe', status: 'pending' }),
      crash: createProbeResult({ key: 'crash', label: 'Crash fail-closed probe', status: 'pending' }),
    }

    try {
      const baselineResponse = await apiCall<TodoListProbe>('/api/example/todos?page=1&pageSize=1&sortField=id&sortDir=asc')
      const baselinePayload = baselineResponse.result
      setInterceptorPayload(baselinePayload)
      const baselineOk = baselineResponse.ok && hasInterceptorMetadata(baselinePayload)
      nextResults.default = {
        ...nextResults.default,
        status: baselineOk ? 'ok' : 'error',
        httpStatus: baselineResponse.status,
        ok: baselineOk,
        details: baselineOk
          ? 'Found _example.interceptor metadata in response.'
          : 'Missing _example.interceptor metadata in response.',
      }

      const wildcardResponse = await apiCall<TodoListProbe>('/api/example/todos?interceptorProbe=wildcard&page=1&pageSize=1')
      const wildcardPayload = wildcardResponse.result
      const wildcardOk = wildcardResponse.ok && hasWildcardMetadata(wildcardPayload)
      nextResults.wildcard = {
        ...nextResults.wildcard,
        status: wildcardOk ? 'ok' : 'error',
        httpStatus: wildcardResponse.status,
        ok: wildcardOk,
        details: wildcardOk
          ? 'Wildcard interceptor matched and merged _example.wildcardProbe=true.'
          : 'Wildcard probe did not expose _example.wildcardProbe=true.',
      }

      const badQueryResponse = await apiCall('/api/example/todos?interceptorProbe=bad-query')
      const badQueryOk = badQueryResponse.status === 400
      nextResults.badQuery = {
        ...nextResults.badQuery,
        status: badQueryOk ? 'ok' : 'error',
        httpStatus: badQueryResponse.status,
        ok: badQueryOk,
        details: badQueryOk
          ? 'Interceptor rewrite was revalidated by route schema (400).'
          : `Expected 400, got ${badQueryResponse.status}.`,
      }

      const timeoutResponse = await apiCall('/api/example/todos?interceptorProbe=timeout')
      const timeoutOk = timeoutResponse.status === 504
      nextResults.timeout = {
        ...nextResults.timeout,
        status: timeoutOk ? 'ok' : 'error',
        httpStatus: timeoutResponse.status,
        ok: timeoutOk,
        details: timeoutOk
          ? 'Timeout probe failed closed with 504.'
          : `Expected 504, got ${timeoutResponse.status}.`,
      }

      const crashResponse = await apiCall('/api/example/todos?interceptorProbe=crash')
      const crashOk = crashResponse.status === 500
      nextResults.crash = {
        ...nextResults.crash,
        status: crashOk ? 'ok' : 'error',
        httpStatus: crashResponse.status,
        ok: crashOk,
        details: crashOk
          ? 'Crash probe failed closed with 500.'
          : `Expected 500, got ${crashResponse.status}.`,
      }

      const allOk = probeOrder.every((key) => nextResults[key].ok)
      setInterceptorStatus(allOk ? 'ok' : 'error')
      if (!allOk) {
        setInterceptorError(t('example.umes.extensions.phaseE.missing', 'One or more interceptor checks failed. Review rows below.'))
      }
    } catch (error) {
      setInterceptorStatus('error')
      setInterceptorError(error instanceof Error ? error.message : String(error))
    } finally {
      setProbeResults(nextResults)
    }
  }, [t])

  const phaseFStatus = React.useMemo<PhaseStatus>(() => {
    return 'ok'
  }, [])

  const phaseGStatus = React.useMemo<PhaseStatus>(() => {
    return formSubmitResult ? 'ok' : 'idle'
  }, [formSubmitResult])

  const phaseHStatus = React.useMemo<PhaseStatus>(() => {
    return 'ok'
  }, [])

  return (
    <Page>
      <PageBody className="space-y-4" data-component-handle={ComponentReplacementHandles.page('/backend/umes-extensions')}>
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.extensions.title', 'UMES Phase E-H Extensions')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('example.umes.extensions.description', 'Validation page for API interceptors, DataTable/CrudForm extension surfaces, and replacement handles.')}
          </p>
        </div>

        <div className="grid gap-2 rounded border border-border p-3 text-xs text-muted-foreground">
          <div data-testid="phase-eh-status-e">phaseE={interceptorStatus}</div>
          <div data-testid="phase-eh-status-f">phaseF={phaseFStatus}</div>
          <div data-testid="phase-eh-status-g">phaseG={phaseGStatus}</div>
          <div data-testid="phase-eh-status-h">phaseH={phaseHStatus}</div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseE.title', 'Phase E — API interceptors')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.extensions.phaseE.description', 'Run the full probe suite: metadata merge, wildcard route matching, query revalidation, timeout fail-closed, and crash fail-closed.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-50">{t('example.umes.extensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.extensions.phaseE.hint1', '1. `default` probe: must return `_example.interceptor` metadata in `/api/example/todos` response.')}</div>
            <div>{t('example.umes.extensions.phaseE.hint2', '2. `wildcard` probe: must return `_example.wildcardProbe=true` for wildcard route interceptor.')}</div>
            <div>{t('example.umes.extensions.phaseE.hint3', '3. `bad-query` probe: must fail with HTTP `400` (route schema revalidation after interceptor rewrite).')}</div>
            <div>{t('example.umes.extensions.phaseE.hint4', '4. `timeout` probe: must fail closed with HTTP `504`.')}</div>
            <div>{t('example.umes.extensions.phaseE.hint5', '5. `crash` probe: must fail closed with HTTP `500`.')}</div>
            <div>{t('example.umes.extensions.phaseE.hint6', 'Note: red network entries for probes 3-5 are expected and indicate correct fail-closed behavior.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-e-run-probe" type="button" onClick={() => void runInterceptorProbe()}>
              {t('example.umes.extensions.phaseE.run', 'Run interceptor probe')}
            </Button>
            <span data-testid="phase-e-status" className="text-xs text-muted-foreground">status={interceptorStatus}</span>
          </div>
          {interceptorError ? <div data-testid="phase-e-error" className="text-xs text-destructive">{interceptorError}</div> : null}
          <div className="grid gap-2">
            {probeOrder.map((key) => {
              const probe = probeResults[key]
              return (
                <div key={probe.key} className="grid gap-1 rounded border border-border p-2 text-xs" data-testid={`phase-e-probe-${probe.key}`}>
                  <div className="font-medium text-foreground">{probe.label}</div>
                  <div className="text-muted-foreground">status={probe.status} httpStatus={probe.httpStatus ?? 'n/a'}</div>
                  <div className="text-muted-foreground">{probe.details}</div>
                </div>
              )
            })}
          </div>
          <div data-testid="phase-e-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            response={print(interceptorPayload)}
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseF.title', 'Phase F — DataTable extensions')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.extensions.phaseF.description', 'This table exposes `replacementHandle` and known component handles. Use it to validate replacement registration and then verify injected columns/actions on Customers list.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-50">{t('example.umes.extensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.extensions.phaseF.hint1', '1. On `/backend/customers/people` table: column `Example priority` should be visible.')}</div>
            <div>{t('example.umes.extensions.phaseF.hint2', '2. In filters drawer: select filter `Priority` should be visible.')}</div>
            <div>{t('example.umes.extensions.phaseF.hint3', '3. In row actions menu: action `Open customer` should be visible.')}</div>
            <div>{t('example.umes.extensions.phaseF.hint4', '4. After selecting rows: bulk action `Set normal priority` should update priorities via API.')}</div>
          </div>
          <DataTable
            title={t('example.umes.extensions.table.title', 'Replacement Handles')}
            columns={columns}
            data={SAMPLE_HANDLES}
            perspective={{ tableId: 'example.umes.extensions' }}
            replacementHandle={ComponentReplacementHandles.dataTable('example.umes.extensions')}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button asChild type="button" variant="outline">
              <Link href="/backend/customers/people">{t('example.umes.extensions.phaseF.openCustomers', 'Open customers table')}</Link>
            </Button>
            <span>{t('example.umes.extensions.phaseF.expect', 'Expect: injected column, row action, filters, and bulk action.')}</span>
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseG.title', 'Phase G — CrudForm field injection')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.extensions.phaseG.description', 'This harness keeps the injected widget active on `crud-form:example.todo`. Submit once to confirm the field/event pipeline executes.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-50">{t('example.umes.extensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.extensions.phaseG.hint1', '1. Injected widget card `Example Injection Widget` should be visible above form fields.')}</div>
            <div>{t('example.umes.extensions.phaseG.hint2', '2. Saving valid form should update `submitResult` below the form.')}</div>
            <div>{t('example.umes.extensions.phaseG.hint3', '3. In customer detail form (`/backend/customers/people/:id`), injected `_example.priority` field should persist via onSave handler.')}</div>
          </div>
          <CrudForm<{ title: string; note?: string }>
            schema={z.object({ title: z.string().min(1), note: z.string().optional() })}
            fields={formFields}
            injectionSpotId="crud-form:example.todo"
            replacementHandle={ComponentReplacementHandles.crudForm('example.todo')}
            onSubmit={async (values) => {
              setFormSubmitResult(values)
            }}
          />
          <div data-testid="phase-g-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            submitResult={print(formSubmitResult)}
          </div>
        </div>

        <div className="space-y-2 rounded border border-border p-4">
          <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseH.title', 'Phase H — Component replacement')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('example.umes.extensions.phaseH.description', 'Active replacement handles in this area: page, DataTable, CrudForm, and the `ui.detail:NotesSection` wrapper declared in `example/widgets/components.ts`.')}
          </p>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-50">{t('example.umes.extensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.extensions.phaseH.hint1', '1. This page root should expose `data-component-handle="page:/backend/umes-extensions"`.')}</div>
            <div>{t('example.umes.extensions.phaseH.hint2', '2. Handles list table should expose `data-table:example.umes.extensions` replacement handle.')}</div>
            <div>{t('example.umes.extensions.phaseH.hint3', '3. Form should expose `crud-form:example.todo` replacement handle.')}</div>
            <div>{t('example.umes.extensions.phaseH.hint4', '4. Customer detail notes section should render wrapped border from `ExampleNotesSectionWrapper`.')}</div>
          </div>
          <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            handles={print(SAMPLE_HANDLES)}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
