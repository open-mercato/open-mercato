'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { FinanceCrudForm as CrudForm } from './FinanceCrudForm'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import createActions from '../data/create-actions.json'

type Cell = string | { text: string; tone: 'info' | 'warning' | 'neutral' | 'error' }
type Config = {
  title: string
  fields: Array<{
    id: string
    label: string
    type: 'text' | 'number' | 'select'
    value: string
    options?: string[]
  }>
  row: Cell[]
}

const configs = createActions as Record<string, Config>

export function hasCreateDemoAction(screenId: string) {
  return screenId in configs
}

export function CreateDemoRecordDialog({
  screenId,
  open,
  onClose,
  onCreate,
}: {
  screenId: string
  open: boolean
  onClose: () => void
  onCreate: (row: Cell[]) => void
}) {
  const t = useT()
  const config = configs[screenId]
  const fields = React.useMemo<CrudField[]>(
    () =>
      config?.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        required: true,
        layout: 'half',
        options: field.options?.map((option) => ({ value: option, label: option })),
      })) ?? [],
    [config],
  )
  const initialValues = React.useMemo(
    () =>
      Object.fromEntries(
        config?.fields.map((field) => [field.id, field.value]) ?? [],
      ),
    [config],
  )

  if (!config) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
        </DialogHeader>
        <CrudForm
          key={screenId}
          fields={fields}
          initialValues={initialValues}
          embedded
          submitLabel={t('finance_previews.screen.save')}
          onSubmit={async (values) => {
            const filled = config.row.map((cell) =>
              typeof cell === 'string'
                ? cell.replace(/\$(\w+)/g, (_, key: string) => String(values[key] ?? ''))
                : cell,
            )
            onCreate(filled)
            onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
