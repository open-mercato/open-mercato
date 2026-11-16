'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { GusLookupPanel } from './GusLookupPanel'
import type { FormValues } from '../lib/mapping'
import type { GusCompany } from '../lib/types'
import { applyFieldMap, isWidgetAllowed, type GusLookupWidgetConfig } from '../lib/widget-config'
import { useGusStatus } from './useGusStatus'

export type GusLookupWidgetContext = {
  entityId?: string | null
  formId?: string
  operation?: 'create' | 'update'
}

export type GusLookupFormWidgetProps = InjectionWidgetComponentProps<GusLookupWidgetContext, FormValues> & {
  config: GusLookupWidgetConfig
}

/** Built-in labels for the "Filled from GUS: …" message; unknown host fields fall back to their id. */
function defaultFieldLabel(field: string, t: (key: string, fallback: string) => string): string {
  switch (field) {
    case 'addresses':
      return t('gus_regon.fields.addresses', 'address')
    case 'city':
      return t('gus_regon.fields.city', 'city')
    case 'country':
      return t('gus_regon.fields.country', 'country')
    case 'displayName':
      return t('gus_regon.fields.displayName', 'display name')
    case 'legalName':
      return t('gus_regon.fields.legalName', 'legal name')
    case 'name':
      return t('gus_regon.fields.name', 'name')
    case 'nip':
      return t('gus_regon.fields.nip', 'NIP')
    case 'postalCode':
      return t('gus_regon.fields.postalCode', 'postal code')
    case 'regon':
      return t('gus_regon.fields.regon', 'REGON')
    case 'street':
      return t('gus_regon.fields.street', 'street')
    default:
      return field
  }
}

/**
 * Generic "Fetch data from GUS REGON" card for any CrudForm injection spot.
 * Driven entirely by a `GusLookupWidgetConfig` (field map or custom `apply`).
 * Hidden until the organization has the integration enabled (and, for the
 * built-in CRM card, the switch on plus an API key), so it never shows a dead button.
 */
export function GusLookupFormWidget({ context, data, onDataChange, disabled, config }: GusLookupFormWidgetProps) {
  const t = useT()
  const pathname = usePathname() ?? ''
  const status = useGusStatus()
  const dataRef = React.useRef<FormValues>(data ?? {})

  React.useEffect(() => {
    dataRef.current = data ?? {}
  }, [data])

  const handleCompany = React.useCallback(
    (company: GusCompany) => {
      const current = dataRef.current
      const { values, filled } = config.apply
        ? config.apply(current, company, { t: (key, fallback) => t(key, fallback) })
        : applyFieldMap(current, company, config.fields ?? {})
      const ceased = company.endDate
        ? ` ${t('gus_regon.lookup.ceased', 'This entity ceased activity on {date}.', { date: company.endDate })}`
        : ''
      if (filled.length > 0) {
        onDataChange?.(values)
        const labels = Array.from(new Set(filled))
          .map((field) => {
            const label = config.fieldLabels?.[field]
            return label ? t(label, label) : defaultFieldLabel(field, t)
          })
          .join(', ')
        flash(`${t('gus_regon.lookup.filled', 'Filled from GUS: {fields}', { fields: labels })}${ceased}`, ceased ? 'warning' : 'success')
      } else {
        flash(`${t('gus_regon.lookup.nothingToFill', 'All fields are already filled — nothing was overwritten.')}${ceased}`, ceased ? 'warning' : 'info')
      }
    },
    [config, onDataChange, t],
  )

  const values = data ?? {}
  if (!isWidgetAllowed(config.gate, status)) return null
  if (config.visible && !config.visible({ pathname, operation: context?.operation, values })) return null

  const initialNip = config.nipField && typeof values[config.nipField] === 'string' ? (values[config.nipField] as string) : ''
  const domId = config.id.replace(/[^a-zA-Z0-9_-]/g, '-')

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4" aria-labelledby={`${domId}-title`}>
      <h3 id={`${domId}-title`} className="text-sm font-semibold">
        {config.titleKey ? t(config.titleKey, config.titleKey) : t('gus_regon.widget.title', 'Fetch data from GUS REGON')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {config.descriptionKey
          ? t(config.descriptionKey, config.descriptionKey)
          : t('gus_regon.widget.descriptionGeneric', 'Enter a NIP to fill this form from the GUS REGON registry. Existing values are never overwritten.')}
      </p>
      <GusLookupPanel disabled={disabled} onCompany={handleCompany} idPrefix={domId} initialNip={initialNip} />
    </section>
  )
}

export default GusLookupFormWidget
