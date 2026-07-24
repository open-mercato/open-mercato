"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
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

type PlotRecord = {
  id: string
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  name: string | null
  externalId: string | null
  description?: string | null
  originCountry: string | null
  geometry: unknown
  areaHa: number | string | null
  producerName: string | null
  isActive: boolean | null
  createdAt: string | null
  updatedAt: string
}

type PlotDetailResponse = {
  items?: PlotRecord[]
}

type PlotFormValues = {
  id: string
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
  updatedAt: string
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

function formatGeometry(value: unknown): string {
  if (!value) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function getRouteId(params?: { id?: string }): string | null {
  const rawId = params?.id
  return typeof rawId === 'string' && rawId.trim().length ? rawId : null
}

export default function EditEudrPlotPage({ params }: { params?: { id?: string } }) {
  const translate = useT()
  const router = useRouter()
  const plotId = React.useMemo(() => getRouteId(params), [params])
  const [record, setRecord] = React.useState<PlotRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      if (!plotId) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const call = await apiCall<PlotDetailResponse>(
          `/api/eudr/plots?id=${encodeURIComponent(plotId)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setError(translate('eudr.plots.form.loadError'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (cancelled) return
        if (items.length === 0) {
          setNotFound(true)
          setRecord(null)
          return
        }
        setRecord(items[0])
      } catch {
        if (!cancelled) setError(translate('eudr.plots.form.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [plotId, translate])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'supplierEntityId',
      layout: 'half',
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
      label: translate('eudr.plots.form.producerName'),
      type: 'text',
    },
    {
      id: 'isActive',
      label: translate('eudr.plots.form.isActive'),
      type: 'custom',
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
      fields: [
        'supplierEntityId',
        'name',
        'externalId',
        'originCountry',
      ],
    },
    {
      id: 'geometry',
      title: translate('eudr.plots.form.geometry'),
      column: 1,
      fields: [
        'geometry',
        'areaHa',
      ],
    },
    {
      id: 'attributes',
      title: translate('eudr.common.attributes'),
      column: 2,
      fields: [
        'producerName',
        'isActive',
      ],
    },
    {
      id: 'notes',
      title: translate('eudr.common.notes'),
      column: 2,
      fields: [
        'description',
      ],
    },
  ], [translate])

  const initialValues = React.useMemo<PlotFormValues | null>(() => {
    if (!record) return null
    return {
      id: record.id,
      supplierEntityId: record.supplierEntityId,
      supplierSnapshot: record.supplierSnapshot,
      name: record.name ?? '',
      externalId: record.externalId ?? '',
      description: typeof record.description === 'string' ? record.description : '',
      originCountry: record.originCountry ?? '',
      geometry: formatGeometry(record.geometry),
      areaHa: record.areaHa === null || record.areaHa === undefined ? '' : String(record.areaHa),
      producerName: record.producerName ?? '',
      isActive: record.isActive !== false,
      updatedAt: record.updatedAt,
    }
  }, [record])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('eudr.plots.form.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={translate('eudr.plots.form.notFound')}
            backHref="/backend/eudr/plots"
            backLabel={translate('eudr.plots.form.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record || !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('eudr.plots.form.loadError')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<PlotFormValues>
          title={translate('eudr.plots.edit.title')}
          backHref="/backend/eudr/plots"
          cancelHref="/backend/eudr/plots"
          deleteRedirect="/backend/eudr/plots"
          submitLabel={translate('eudr.plots.form.submitUpdate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
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
            const payload: Record<string, unknown> = {
              id: record.id,
              supplierEntityId,
              supplierSnapshot: isCompanySnapshot(values.supplierSnapshot) ? values.supplierSnapshot : null,
              name,
              externalId: optionalText(values.externalId),
              originCountry: originCountry.toUpperCase(),
              geometry: parsePlotGeometryInput(values.geometry, translate),
              areaHa: isPolygonGeometry(values.geometry) ? null : optionalNumber(values.areaHa, translate),
              producerName: optionalText(values.producerName),
              isActive: values.isActive !== false,
            }
            const nextDescription = optionalText(values.description)
            if (nextDescription || Object.prototype.hasOwnProperty.call(record, 'description')) {
              payload.description = nextDescription
            }
            await updateCrud('eudr/plots', payload, {
              errorMessage: translate('eudr.plots.form.updateError'),
            })
            flash(translate('eudr.plots.form.updateSuccess'), 'success')
            router.push('/backend/eudr/plots')
          }}
          onDelete={async () => {
            await deleteCrud('eudr/plots', record.id, {
              errorMessage: translate('eudr.plots.form.deleteError'),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}
