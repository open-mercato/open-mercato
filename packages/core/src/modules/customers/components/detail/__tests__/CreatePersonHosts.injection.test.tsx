/** @jest-environment jsdom */

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { InjectionFieldWidget, InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import {
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import CreatePersonPage from '../../../backend/customers/people/create/page'
import { CreatePersonDialog } from '../CreatePersonDialog'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/customers/people/create',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/fields/registry', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/fields/registry'),
  loadGeneratedFieldRegistrations: async () => {},
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: async () => ({ definitions: [], metadata: {} }),
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  ...jest.requireActual('../hooks/useCustomerDictionary'),
  ensureCustomerDictionary: async () => ({ entries: [] }),
}))

const group: InjectionWidgetModule = {
  metadata: { id: 'test_extensions.person-create-group', title: 'Person creation extension' },
  Widget: () => <p>Available before the person is saved</p>,
}

const field: InjectionFieldWidget = {
  metadata: { id: 'test_extensions.person-create-field' },
  fields: [{ id: '_extension.reference', type: 'text', label: 'Extension reference', group: 'details' }],
}

beforeEach(() => {
  const entries: ModuleInjectionWidgetEntry[] = [group, field].map((widget) => ({
    moduleId: 'test_extensions',
    key: widget.metadata.id,
    widgetId: widget.metadata.id,
    source: 'package',
    loader: async () => widget,
  }))
  registerEnabledModuleIds(['customers', 'test_extensions'])
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{
    moduleId: 'test_extensions',
    table: {
      'crud-form:customers.person': { widgetId: group.metadata.id, kind: 'group' },
      'crud-form:customers.person:fields': field.metadata.id,
    },
  }], entries)
})

afterEach(() => {
  registerCoreInjectionTables([])
  registerCoreInjectionWidgets([])
  registerEnabledModuleIds([])
})

describe('Declared person create hosts', () => {
  it.each([
    { surface: 'create page', form: <CreatePersonPage /> },
    {
      surface: 'company dialog',
      form: <CreatePersonDialog open companyId="company-1" companyName="Example Company" onClose={() => {}} />,
    },
  ])('renders the canonical group and field on the $surface', async ({ form }) => {
    const view = renderWithProviders(form)

    expect(await view.findByText('Available before the person is saved')).toBeVisible()
    expect(await view.findByLabelText('Extension reference')).toBeVisible()
  })
})
