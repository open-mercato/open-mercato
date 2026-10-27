/** @jest-environment jsdom */
jest.setTimeout(15000)

// Regression coverage for @pkarw's 2026-10-20 re-review (#5915): `page.test.tsx` and
// `CreatePersonDialog.injectionHost.test.tsx` mock `CrudForm` entirely, so they prove
// the person create page and dialog pass the right `injectionSpotId`/
// `legacyInjectionSpotId` props, but never that a widget registered on the real
// exported `crud-form:customers.person` host (or its deprecated
// `crud-form:customers.customer_entity` bridge) actually mounts and runs through the
// real `CrudForm` + `InjectionSpot` pipeline. This renders the real `CrudForm` wired
// with the exact spot ids both person surfaces use, mocking only the registry data
// source (`loadInjectionWidgetsForSpot`), the way `InjectionSpot.remount.test.tsx` and
// `CrudForm.legacyInjectionBridge.test.tsx` do.
import { crudFormExtensionSpotId } from '@open-mercato/shared/modules/widgets/extension-points'
import { extensionPoints } from '../../../extension-points'

const PRIMARY_SPOT = extensionPoints.hosts.personForm.spotId
const LEGACY_SPOT = crudFormExtensionSpotId('customers.customer_entity')

let widgetsBySpot: Record<string, unknown[]> = {}
const mockLoadInjectionWidgetsForSpot = jest.fn((spotId: string) =>
  Promise.resolve(widgetsBySpot[spotId] ?? []),
)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: (...args: [string]) => mockLoadInjectionWidgetsForSpot(...args),
  loadInjectionDataWidgetsForSpot: () => Promise.resolve([]),
}))

import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'

const fields: CrudField[] = [{ id: 'displayName', label: 'Name', type: 'text' }]

// Shape matches `LoadedInjectionWidget`, the raw return type of
// `loadInjectionWidgetsForSpot` — NOT `InjectionSpot`'s own post-`toLoadedWidget`
// `LoadedWidget` shape, which nests this under a `module` key.
function makeWidget(widgetId: string, testId: string) {
  return {
    metadata: { id: widgetId, title: widgetId, description: '' },
    moduleId: 'test-module',
    key: widgetId,
    placement: { kind: 'stack' },
    Widget: () => <div data-testid={testId}>{testId}</div>,
  }
}

function renderPersonCreateForm() {
  return renderWithProviders(
    React.createElement(CrudForm as never, {
      title: 'Create person',
      entityIds: ['customers:customer_entity', 'customers:customer_person_profile'],
      injectionSpotId: PRIMARY_SPOT,
      legacyInjectionSpotId: LEGACY_SPOT,
      fields,
      onSubmit: () => {},
    }),
  )
}

describe('Person create surfaces real-mount injection host (#5915 re-review)', () => {
  afterEach(() => {
    widgetsBySpot = {}
    mockLoadInjectionWidgetsForSpot.mockClear()
  })

  it('mounts a widget registered on the real crud-form:customers.person host used by both person create surfaces', async () => {
    widgetsBySpot[PRIMARY_SPOT] = [makeWidget('canonical-widget', 'canonical-person-widget')]

    const { container } = renderPersonCreateForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="canonical-person-widget"]')).toBeTruthy()
    })
  })

  it('keeps a widget registered only on the legacy crud-form:customers.customer_entity host rendering via the bridge', async () => {
    widgetsBySpot[LEGACY_SPOT] = [makeWidget('legacy-widget', 'legacy-person-widget')]

    const { container } = renderPersonCreateForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="legacy-person-widget"]')).toBeTruthy()
    })
  })

  it('dispatches onBeforeSave to a widget mounted on the canonical host before create submits', async () => {
    const onBeforeSave = jest.fn().mockResolvedValue({ ok: true })
    widgetsBySpot[PRIMARY_SPOT] = [
      {
        metadata: { id: 'lifecycle-widget', title: 'lifecycle-widget', description: '' },
        moduleId: 'test-module',
        key: 'lifecycle-widget',
        placement: { kind: 'stack' },
        Widget: () => <div data-testid="lifecycle-person-widget" />,
        eventHandlers: { onBeforeSave },
      },
    ]
    const onSubmit = jest.fn().mockResolvedValue(undefined)

    const { container, getByRole } = renderWithProviders(
      React.createElement(CrudForm as never, {
        title: 'Create person',
        entityIds: ['customers:customer_entity', 'customers:customer_person_profile'],
        injectionSpotId: PRIMARY_SPOT,
        legacyInjectionSpotId: LEGACY_SPOT,
        fields,
        initialValues: { displayName: 'Jan Kowalski' },
        onSubmit,
      }),
    )

    await waitFor(() => {
      expect(container.querySelector('[data-testid="lifecycle-person-widget"]')).toBeTruthy()
    })

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit ? form.requestSubmit() : getByRole('button', { name: /save/i }).click()
    })

    await waitFor(() => expect(onBeforeSave).toHaveBeenCalled())
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })
})
