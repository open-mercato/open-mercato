/**
 * @jest-environment jsdom
 */
// Regression coverage for @pkarw's 2026-10-20 re-review (#5915): the other
// `CreateDealForm` specs mock `InjectionSpot`/`useInjectionSpotEvents` entirely, so
// they prove the create form *calls* those APIs correctly but never that a widget
// registered on the real exported `crud-form:customers.deal` host actually mounts
// and runs through the real injection pipeline. This file keeps `InjectionSpot` and
// `useInjectionSpotEvents` real, mocking only the registry data source
// (`loadInjectionWidgetsForSpot`) the way `InjectionSpot.remount.test.tsx` does.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'
import { extensionPoints } from '../../../../extension-points'

const mockPush = jest.fn()
const mockCreateCrud = jest.fn()
const mockRunMutation = jest.fn()
const mockLoadInjectionWidgetsForSpot = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/backend/customers/deals/create',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/link', () => {
  const ReactForMock = require('react') as typeof React
  return {
    __esModule: true,
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
      ReactForMock.createElement('a', { href, ...props }, children),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: string | Record<string, string | number>) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: jest.fn(),
  }),
}))

// Keeps the real `InjectionSpot` component and `useInjectionSpotEvents` hook; only
// the registry fetch is replaced, matching `InjectionSpot.remount.test.tsx`.
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: (...args: unknown[]) => mockLoadInjectionWidgetsForSpot(...args),
}))

jest.mock('../../DealForm', () => {
  const textField = z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string())
  const numericField = z.preprocess(
    (value) => (value === '' || value == null ? undefined : Number(value)),
    z.number().optional(),
  )
  return {
    dealFormSchema: z.object({
      title: z.string().trim().min(1, 'customers.people.detail.deals.titleRequired'),
      status: textField,
      pipelineId: textField,
      pipelineStageId: textField,
      valueAmount: numericField,
      valueCurrency: textField,
      probability: numericField,
      expectedCloseAt: textField,
      description: textField,
      personIds: z.array(z.string()).default([]),
      companyIds: z.array(z.string()).default([]),
    }),
  }
})

jest.mock('../useDealPipelines', () => ({
  useDealPipelines: () => ({
    pipelines: [],
    stages: [],
    loadStages: jest.fn(),
  }),
}))

jest.mock('../DealDetailsFields', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealDetailsFields: ({
      values,
      patch,
    }: {
      values: { title: string }
      patch: (partial: { title: string }) => void
    }) =>
      ReactForMock.createElement(
        'label',
        null,
        'Deal title',
        ReactForMock.createElement('input', {
          value: values.title,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ title: event.target.value }),
        }),
      ),
  }
})

jest.mock('../DealAssociationsField', () => ({
  DealAssociationsField: () => null,
}))

jest.mock('../DealCustomAttributes', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealCustomAttributes: ({ onLoaded }: { onLoaded?: (state: { fields: unknown[]; definitions: unknown[] }) => void }) => {
      const loadedRef = ReactForMock.useRef(false)
      ReactForMock.useEffect(() => {
        if (loadedRef.current) return
        loadedRef.current = true
        onLoaded?.({ fields: [], definitions: [] })
      }, [onLoaded])
      return null
    },
  }
})

function makeRealWidget(id: string, eventHandlers: Record<string, jest.Mock>) {
  return {
    metadata: { id },
    moduleId: 'test_module',
    key: id,
    placement: { kind: 'stack' as const },
    eventHandlers,
    Widget: ({ context }: { context: unknown }) => {
      const typedContext = context as { operation?: string; recordId?: string }
      return (
        <div data-testid="real-deal-widget">
          {typedContext.operation}:{typedContext.recordId ?? 'none'}
        </div>
      )
    },
  }
}

beforeEach(() => {
  mockPush.mockClear()
  mockCreateCrud.mockReset()
  mockCreateCrud.mockResolvedValue({ id: 'deal-1' })
  mockRunMutation.mockReset()
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  mockLoadInjectionWidgetsForSpot.mockReset()
  mockFlash.mockClear()
})

describe('CreateDealForm real-mount injection (#5915 re-review)', () => {
  it('mounts a widget registered on the real crud-form:customers.deal host, in create mode', async () => {
    mockLoadInjectionWidgetsForSpot.mockImplementation(async (spotId: string) =>
      spotId === extensionPoints.hosts.dealForm.spotId ? [makeRealWidget('real-widget', {})] : [],
    )

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    const widget = await screen.findByTestId('real-deal-widget')
    expect(widget).toHaveTextContent('create:none')
  })

  it('dispatches the real onBeforeSave/onSave/onAfterSave lifecycle to a mounted widget', async () => {
    const onBeforeSave = jest.fn().mockResolvedValue({ ok: true })
    const onSave = jest.fn().mockResolvedValue(undefined)
    const onAfterSave = jest.fn().mockResolvedValue(undefined)
    mockLoadInjectionWidgetsForSpot.mockImplementation(async (spotId: string) =>
      spotId === extensionPoints.hosts.dealForm.spotId
        ? [makeRealWidget('real-widget', { onBeforeSave, onSave, onAfterSave })]
        : [],
    )

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)
    await screen.findByTestId('real-deal-widget')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])
    })

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    await waitFor(() => expect(onAfterSave).toHaveBeenCalled())
    expect(onBeforeSave.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0])
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onAfterSave.mock.invocationCallOrder[0])
  })

  it('blocks the create when the real widget refuses the save in onBeforeSave', async () => {
    const onBeforeSave = jest.fn().mockResolvedValue({ ok: false, message: 'Blocked by the real widget' })
    mockLoadInjectionWidgetsForSpot.mockImplementation(async (spotId: string) =>
      spotId === extensionPoints.hosts.dealForm.spotId ? [makeRealWidget('real-widget', { onBeforeSave })] : [],
    )

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)
    await screen.findByTestId('real-deal-widget')

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(onBeforeSave).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockFlash).toHaveBeenCalledWith('Blocked by the real widget', 'error'),
    )
    expect(mockCreateCrud).not.toHaveBeenCalled()
  })
})
