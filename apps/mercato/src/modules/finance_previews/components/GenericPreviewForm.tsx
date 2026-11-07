'use client'

import * as React from 'react'
import { z } from 'zod'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { FinanceCrudForm as CrudForm } from './FinanceCrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@open-mercato/ui/primitives/card'
import copy from '../data/generic-form-copy.json'

const draftSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)
const allocationAmount = 84000
const shareSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim()
      ? Number(value.replace(',', '.'))
      : value,
  z.number().min(0).max(100),
)
const allocationSchema = z
  .object({
    field_0: z.string().min(1),
    field_1: z.string().min(1),
    field_2: z.string().min(1),
    field_3: shareSchema,
    field_4: shareSchema,
  })
  .refine(
    (values) => Math.abs(values.field_3 + values.field_4 - 100) < 0.000001,
  )

type Draft = z.infer<typeof draftSchema>

function readDraft(screenId: string): Draft | null {
  try {
    const stored = window.sessionStorage.getItem(
      `finance-preview-form-${screenId}`,
    )
    if (!stored) return null
    const result = draftSchema.safeParse(JSON.parse(stored))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function GenericPreviewForm({
  screenId,
  fields,
  initialValues,
  onPreview,
}: {
  screenId: string
  fields: CrudField[]
  initialValues: Record<string, string>
  onPreview: () => void
}) {
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  React.useEffect(() => {
    setDraft(readDraft(screenId))
    setLoaded(true)
  }, [screenId])
  if (!loaded) return <LoadingMessage label={copy.loading} />
  return (
    <div className="space-y-4">
      {screenId === 's31' ? (
        <p className="text-sm text-muted-foreground">{copy.formHint}</p>
      ) : null}
      {saved ? (
        <Alert status="information" style="stroke" size="sm">
          {copy.saved}
        </Alert>
      ) : null}
      <CrudForm<Record<string, unknown>>
        formId={`finance-preview-form-${screenId}`}
        fields={fields}
        initialValues={draft ?? initialValues}
        embedded
        submitLabel={screenId === 's31' ? copy.preview : copy.saveDraft}
        onSubmit={async (values) => {
          setSaved(false)
          if (screenId === 's31') {
            const result = allocationSchema.safeParse(values)
            if (!result.success) {
              const missingSelection = ['field_0', 'field_1', 'field_2'].some(
                (key) => !values[key],
              )
              throw createCrudFormError(
                missingSelection ? copy.required : copy.invalidShares,
                {
                  field_3: copy.invalidShares,
                  field_4: copy.invalidShares,
                },
              )
            }
          }
          const result = draftSchema.safeParse(values)
          if (!result.success) throw createCrudFormError(copy.storageError)
          try {
            window.sessionStorage.setItem(
              `finance-preview-form-${screenId}`,
              JSON.stringify(result.data),
            )
          } catch {
            throw createCrudFormError(copy.storageError)
          }
          setSaved(true)
          if (screenId === 's31') onPreview()
        }}
      />
    </div>
  )
}

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(
    amount,
  )
type AllocationRow = {
  id: string
  center: string
  share: number
  amount: number
}
const columns: ColumnDef<AllocationRow, unknown>[] = [
  { id: 'center', header: copy.center, accessorKey: 'center' },
  {
    id: 'share',
    header: copy.share,
    accessorKey: 'share',
    cell: ({ row }) =>
      `${new Intl.NumberFormat('pl-PL').format(row.original.share)}%`,
  },
  {
    id: 'amount',
    header: copy.amount,
    accessorKey: 'amount',
    cell: ({ row }) => (
      <span className="tabular-nums">{formatMoney(row.original.amount)}</span>
    ),
  },
]

export function AllocationPreviewResult({ onEdit }: { onEdit: () => void }) {
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  React.useEffect(() => {
    setDraft(readDraft('s31'))
    setLoaded(true)
  }, [])
  if (!loaded) return <LoadingMessage label={copy.loading} />
  const result = allocationSchema.safeParse(draft)
  if (!result.success)
    return (
      <Card>
        <CardHeader>
          <CardTitle>{copy.emptyTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{copy.emptyHint}</p>
          <Button type="button" variant="primary-filled" onClick={onEdit}>
            {copy.edit}
          </Button>
        </CardContent>
      </Card>
    )
  const values = result.data
  const itAmount = Math.round(allocationAmount * values.field_3) / 100
  const rows: AllocationRow[] = [
    { id: 'it', center: copy.it, share: values.field_3, amount: itAmount },
    {
      id: 'sales',
      center: copy.sales,
      share: values.field_4,
      amount: allocationAmount - itAmount,
    },
  ]
  return (
    <Card data-testid="allocation-result">
      <CardHeader>
        <CardTitle>{copy.resultTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{copy.resultHint}</p>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            [copy.source, values.field_0],
            [copy.method, values.field_1],
            [copy.period, values.field_2],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <DataTable
          columns={columns}
          data={rows}
          emptyState={<EmptyState title={copy.emptyTitle} size="sm" />}
          embedded
        />
        <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">{copy.total}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(allocationAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{copy.remaining}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(0)}
            </dd>
          </div>
        </dl>
        <Button type="button" variant="outline" onClick={onEdit}>
          {copy.edit}
        </Button>
      </CardContent>
    </Card>
  )
}
