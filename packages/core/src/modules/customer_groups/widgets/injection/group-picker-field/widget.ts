import { lazy } from 'react'
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'

// Step 1.11 — replaces the free-text `customerGroupId` UUID input on the
// catalog price editor with a searchable picker sourced from
// `/api/customer_groups/customer-groups`.
//
// This is a purely additive, optional injection: no `requires` entry is
// declared anywhere, so `catalog` never gains a hard dependency on
// `customer_groups`. When `customer_groups` is ejected/disabled, the widget
// is never registered, `crud-form:<entityId>:fields` simply resolves empty,
// and the host form falls back to its current plain free-text input with
// no error — see `packages/core/src/modules/wms/widgets/injection/catalog-inventory-profile/widget.ts`
// for the same pattern proven against `catalog.product`.
const widget: InjectionFieldWidget = {
  metadata: {
    id: 'customer_groups.injection.group-picker-field',
    priority: 100,
    features: ['customer_groups.groups.view'],
  },
  fields: [
    {
      id: 'customerGroupId',
      label: '',
      labelKey: 'customer_groups.widgets.groupPicker.label',
      type: 'custom',
      // Targets the `scope` group on `catalog.catalog_product_price` (see
      // `catalog/components/prices/priceFormFields.tsx`, read-only reference —
      // this file is never edited by this module). Field ids collide by
      // design: `CrudForm` resolves a field by id via a `Map` built from
      // `[...fields, ...injectedFieldWidgets]`, so the later (injected) entry
      // wins and replaces the host's plain-text `customerGroupId` input; its
      // value is still submitted with the host payload. `label` stays empty
      // because `GroupPickerField` renders its own translated label.
      group: 'scope',
      customComponent: lazy(() => import('../../../components/GroupPickerField')),
    },
  ],
}

export default widget
