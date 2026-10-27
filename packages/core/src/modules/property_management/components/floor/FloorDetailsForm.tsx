"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FloorLayoutData } from './types'

type FloorFormValues = {
  id: string
  name: string
  sizeX: number | string
  sizeY: number | string
  updatedAt: string
}

export type FloorDetailsFormProps = {
  floor: FloorLayoutData['floor']
  onSaved: () => void
}

export function FloorDetailsForm({ floor, onSaved }: FloorDetailsFormProps) {
  const t = useT()
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('property_management.floors.details.name', 'Name'), type: 'text', required: true, layout: 'full' },
    {
      id: 'sizeX',
      label: t('property_management.floors.details.sizeX', 'Width (x), metres'),
      type: 'number',
      required: true,
      layout: 'half',
    },
    {
      id: 'sizeY',
      label: t('property_management.floors.details.sizeY', 'Depth (y), metres'),
      type: 'number',
      required: true,
      layout: 'half',
    },
  ], [t])
  const initialValues = React.useMemo<FloorFormValues>(() => ({
    id: floor.id,
    name: floor.name,
    sizeX: floor.sizeX,
    sizeY: floor.sizeY,
    updatedAt: floor.updatedAt,
  }), [floor])
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="pm-floor-details-title">
      <h2 id="pm-floor-details-title" className="text-base font-semibold">
        {t('property_management.floors.details.title', 'Floor details')}
      </h2>
      <CrudForm<FloorFormValues>
        key={floor.updatedAt}
        embedded
        formId="property-management-floor-details"
        fields={fields}
        initialValues={initialValues}
        submitLabel={t('property_management.floors.details.save', 'Save floor')}
        onSubmit={async (values) => {
          await updateCrud('property_management/floors', {
            id: floor.id,
            name: String(values.name ?? '').trim(),
            sizeX: Number(values.sizeX),
            sizeY: Number(values.sizeY),
          }, {
            errorMessage: t('property_management.floors.details.saveError', 'Could not save the floor.'),
          })
          flash(t('property_management.floors.details.saved', 'Floor saved.'), 'success')
          onSaved()
        }}
      />
    </section>
  )
}
