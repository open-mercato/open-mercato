'use client'

import * as React from 'react'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import type { ColumnDef } from '@tanstack/react-table'

type TodoListProbe = {
  _example?: {
    interceptor?: {
      processedAt?: string
      processingTimeMs?: number
    }
  }
}

type HandleRow = {
  id: string
  label: string
}

const SAMPLE_HANDLES: HandleRow[] = [
  { id: ComponentReplacementHandles.page('/backend/umes-extensions'), label: 'Page handle' },
  { id: ComponentReplacementHandles.dataTable('example.umes.extensions'), label: 'DataTable handle' },
  { id: ComponentReplacementHandles.crudForm('example.todo'), label: 'CrudForm handle' },
  { id: ComponentReplacementHandles.section('ui.detail', 'NotesSection'), label: 'Section handle example' },
]

export default function UmesExtensionsPage() {
  const t = useT()
  const [interceptorStatus, setInterceptorStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [interceptorPayload, setInterceptorPayload] = React.useState<TodoListProbe | null>(null)
  const [interceptorError, setInterceptorError] = React.useState<string | null>(null)

  const columns = React.useMemo<ColumnDef<HandleRow>[]>(() => [
    { accessorKey: 'label', header: t('example.umes.extensions.table.label', 'Label') },
    { accessorKey: 'id', header: t('example.umes.extensions.table.handle', 'Handle') },
  ], [t])

  const formFields = React.useMemo<CrudField[]>(() => [
    { id: 'title', label: t('example.umes.extensions.form.title', 'Title'), type: 'text', required: true },
    { id: 'note', label: t('example.umes.extensions.form.note', 'Note'), type: 'textarea' },
  ], [t])

  const runInterceptorProbe = React.useCallback(async () => {
    setInterceptorStatus('pending')
    setInterceptorError(null)
    try {
      const payload = await readApiResultOrThrow<TodoListProbe>('/api/example/todos?page=1&pageSize=1&sortField=id&sortDir=asc')
      setInterceptorPayload(payload)
      setInterceptorStatus(payload?._example?.interceptor ? 'ok' : 'error')
      if (!payload?._example?.interceptor) {
        setInterceptorError(t('example.umes.extensions.phaseE.missing', 'Interceptor metadata missing in response'))
      }
    } catch (error) {
      setInterceptorStatus('error')
      setInterceptorError(error instanceof Error ? error.message : String(error))
    }
  }, [t])

  return (
    <Page>
      <PageBody className="space-y-4" data-component-handle={ComponentReplacementHandles.page('/backend/umes-extensions')}>
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.extensions.title', 'UMES Phase E-H Extensions')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('example.umes.extensions.description', 'Validation page for API interceptors, DataTable/CrudForm extension surfaces, and replacement handles.')}
          </p>
        </div>

        <div className="rounded border p-4 space-y-2">
          <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseE.title', 'Phase E — API interceptors')}</h2>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void runInterceptorProbe()}>{t('example.umes.extensions.phaseE.run', 'Run interceptor probe')}</Button>
            <span data-testid="phase-e-status" className="text-xs text-muted-foreground">status={interceptorStatus}</span>
          </div>
          {interceptorError ? <div className="text-xs text-destructive">{interceptorError}</div> : null}
          <pre className="text-xs bg-muted/40 rounded p-2 overflow-auto">{JSON.stringify(interceptorPayload, null, 2)}</pre>
        </div>

        <div className="rounded border p-4 space-y-3">
          <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseF.title', 'Phase F/H — DataTable handle')}</h2>
          <DataTable
            title={t('example.umes.extensions.table.title', 'Replacement Handles')}
            columns={columns}
            data={SAMPLE_HANDLES}
            perspective={{ tableId: 'example.umes.extensions' }}
            replacementHandle={ComponentReplacementHandles.dataTable('example.umes.extensions')}
          />
        </div>

        <div className="rounded border p-4 space-y-3">
          <h2 className="text-base font-semibold">{t('example.umes.extensions.phaseG.title', 'Phase G/H — CrudForm handle')}</h2>
          <CrudForm<{ title: string; note?: string }>
            schema={z.object({ title: z.string().min(1), note: z.string().optional() })}
            fields={formFields}
            injectionSpotId="crud-form:example.todo"
            replacementHandle={ComponentReplacementHandles.crudForm('example.todo')}
            onSubmit={async () => undefined}
          />
        </div>
      </PageBody>
    </Page>
  )
}
