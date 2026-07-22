"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  CompanySelectField,
  CountrySelectField,
  type CompanySnapshot,
} from '../../../../components/formConfig'
import { GeometryInput } from '../../../../components/GeometryInput'
import { validatePlotGeometry } from '../../../../lib/geometry'

type PlotFormValues = {
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  name: string
  externalId: string
  description: string
  originCountry: string
  geometry: string
  areaHa: string
  producerName: string
  isActive: boolean
} & Record<string, unknown>

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    const message = translate('eudr.plots.form.areaHaInvalid')
    throw createCrudFormError(message, { areaHa: message })
  }
  return parsed
}

function isCompanySnapshot(value: unknown): value is CompanySnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePlotGeometryInput(raw: unknown, translate: ReturnType<typeof useT>): unknown {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    const message = translate('eudr.errors.geometryRequired')
    throw createCrudFormError(message, { geometry: message })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const message = translate('eudr.errors.geometryInvalid')
    throw createCrudFormError(message, { geometry: message })
  }
  const validation = validatePlotGeometry(parsed)
  if (!validation.ok) {
    const message = translate(`eudr.errors.${validation.errorKey}`)
    throw createCrudFormError(message, { geometry: message })
  }
  return parsed
}

function isPolygonGeometry(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.trim().length === 0) return false
  try {
    const validation = validatePlotGeometry(JSON.parse(raw))
    return validation.ok && validation.plotType === 'polygon'
  } catch {
    return false
  }
}

export default function CreateEudrPlotPage() {
  const translate = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'supplierEntityId',
      label: translate('eudr.plots.form.supplier'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue, setFormValue }) => (
        <CompanySelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          onSnapshot={(snapshot) => setFormValue?.('supplierSnapshot', snapshot)}
          placeholder={translate('eudr.evidenceSubmissions.form.supplierPlaceholder')}
          loadError={translate('eudr.evidenceSubmissions.form.supplierLoadError')}
        />
      ),
    },
    {
      id: 'name',
      layout: 'half',
      label: translate('eudr.plots.form.name'),
      type: 'text',
      required: true,
    },
    {
      id: 'externalId',
      layout: 'half',
      label: translate('eudr.plots.form.externalId'),
      type: 'text',
    },
    {
      id: 'description',
      label: translate('eudr.plots.form.description'),
      type: 'textarea',
      rows: 4,
    },
    {
      id: 'originCountry',
      layout: 'half',
      label: translate('eudr.plots.form.originCountry'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue, disabled }) => (
        <CountrySelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          disabled={disabled}
          placeholder={translate('eudr.plots.form.originCountryPlaceholder')}
        />
      ),
    },
    {
      id: 'geometry',
      label: translate('eudr.plots.form.geometry'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue, disabled }) => (
        <GeometryInput
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(nextValue) => setValue(nextValue)}
          disabled={disabled}
        />
      ),
    },
    {
      id: 'areaHa',
      layout: 'half',
      label: translate('eudr.plots.form.areaHa'),
      type: 'custom',
      description: translate('eudr.plots.form.areaHaHelp'),
      component: ({ id, value, setValue, values, disabled }) => {
        const polygonGeometry = isPolygonGeometry(values?.geometry)
        return (
          <Input
            id={id}
            type="number"
            min="0"
            step="0.0001"
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            disabled={disabled || polygonGeometry}
            onChange={(event) => setValue(event.target.value)}
          />
        )
      },
    },
    {
      id: 'producerName',
      layout: 'half',
      label: translate('eudr.plots.form.producerName'),
      type: 'text',
    },
    {
      id: 'isActive',
      layout: 'half',
      label: translate('eudr.plots.form.isActive'),
      type: 'custom',
      defaultValue: true,
      component: ({ value, setValue, disabled }) => (
        <Switch
          checked={value !== false}
          disabled={disabled}
          onCheckedChange={setValue}
        />
      ),
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.plots.form.details'),
      column: 1,
      fields: ['supplierEntityId', 'name', 'externalId', 'description', 'originCountry', 'geometry', 'areaHa', 'producerName', 'isActive'],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <CrudForm<PlotFormValues>
          title={translate('eudr.plots.create.title')}
          backHref="/backend/eudr/plots"
          cancelHref="/backend/eudr/plots"
          submitLabel={translate('eudr.plots.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={{
            supplierEntityId: '',
            supplierSnapshot: null,
            name: '',
            externalId: '',
            description: '',
            originCountry: '',
            geometry: '',
            areaHa: '',
            producerName: '',
            isActive: true,
          }}
          onSubmit={async (values) => {
            const supplierEntityId = optionalText(values.supplierEntityId)
            if (!supplierEntityId) {
              const message = translate('eudr.plots.form.supplierRequired')
              throw createCrudFormError(message, { supplierEntityId: message })
            }
            const name = optionalText(values.name)
            if (!name) {
              const message = translate('eudr.plots.form.nameRequired')
              throw createCrudFormError(message, { name: message })
            }
            const originCountry = optionalText(values.originCountry)
            if (!originCountry) {
              const message = translate('eudr.plots.form.originCountryRequired')
              throw createCrudFormError(message, { originCountry: message })
            }
            await createCrud('eudr/plots', {
              supplierEntityId,
              supplierSnapshot: isCompanySnapshot(values.supplierSnapshot) ? values.supplierSnapshot : null,
              name,
              externalId: optionalText(values.externalId),
              description: optionalText(values.description),
              originCountry: originCountry.toUpperCase(),
              geometry: parsePlotGeometryInput(values.geometry, translate),
              areaHa: isPolygonGeometry(values.geometry) ? null : optionalNumber(values.areaHa, translate),
              producerName: optionalText(values.producerName),
              isActive: values.isActive !== false,
            }, {
              errorMessage: translate('eudr.plots.form.createError'),
            })
            flash(translate('eudr.plots.form.createSuccess'), 'success')
            router.push('/backend/eudr/plots')
          }}
        />
      </PageBody>
    </Page>
  )
}
