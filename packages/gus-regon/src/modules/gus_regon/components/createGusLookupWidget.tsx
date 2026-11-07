import * as React from 'react'
import type { InjectionWidgetComponentProps, InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { GusLookupFormWidget, type GusLookupWidgetContext } from './GusLookupFormWidget'
import type { FormValues } from '../lib/mapping'
import { buildWidgetMetadata, type GusLookupWidgetConfig } from '../lib/widget-config'

export type { GusCompanyField, GusFieldMap, GusLookupWidgetConfig } from '../lib/widget-config'

/**
 * Not a client module on purpose: widget definition files call it at module
 * load, which must also work when the widget registry is imported on the
 * server. Only `GusLookupFormWidget` (rendered inside) is a client component.
 *
 * Registers a "Fetch from GUS" card for any CrudForm — the declarative way to
 * attach GUS REGON lookup to a host module's form.
 *
 * In the host module:
 *
 * ```ts
 * // widgets/injection/gus-supplier/widget.ts
 * import { createGusLookupWidget } from '@open-mercato/gus-regon/modules/gus_regon/components/createGusLookupWidget'
 *
 * export default createGusLookupWidget({
 *   id: 'purchasing.injection.gus-supplier',
 *   nipField: 'taxId',
 *   fields: { name: 'name', regon: 'regon', streetLine: 'street', postalCode: 'postalCode', city: 'city', country: 'country' },
 * })
 *
 * // widgets/injection-table.ts
 * export const injectionTable = { 'crud-form:purchasing.supplier': ['purchasing.injection.gus-supplier'] }
 * ```
 */
export function createGusLookupWidget(config: GusLookupWidgetConfig): InjectionWidgetModule<GusLookupWidgetContext, FormValues> {
  const metadata = buildWidgetMetadata(config)
  function GusLookupWidget(props: InjectionWidgetComponentProps<GusLookupWidgetContext, FormValues>) {
    return <GusLookupFormWidget {...props} config={config} />
  }
  GusLookupWidget.displayName = `GusLookupWidget(${config.id})`
  return { metadata, Widget: GusLookupWidget }
}

export default createGusLookupWidget
