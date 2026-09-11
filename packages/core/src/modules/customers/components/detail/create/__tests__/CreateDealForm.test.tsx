/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'
import { extensionPoints } from '../../../../extension-points'

const mockPush = jest.fn()
const injectionSpotProps: Array<Record<string, unknown>> = []
const mockCreateCrud = jest.fn()
const mockRunMutation = jest.fn()
const mockTriggerSpotEvent = jest.fn()
const spotEventHookSpotIds: string[] = []
const scopedHeaderCalls: Array<Record<string, string>> = []
let mockCustomDefinitions: Array<{
  key: string
  kind: string
  label?: string
  defaultValue?: string | number | boolean | null
  validation?: Array<{ rule: 'required'; message: string }>
}> = []

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

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: (props: Record<string, unknown>) => {
    injectionSpotProps.push(props)
    return null
  },
  useInjectionSpotEvents: (spotId: string) => {
    spotEventHookSpotIds.push(spotId)
    return { triggerEvent: mockTriggerSpotEvent, widgets: [] }
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: jest.fn(),
  }),
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
      errors,
      patch,
    }: {
      values: { title: string }
      errors: Record<string, string>
      patch: (partial: { title: string }) => void
    }) =>
      ReactForMock.createElement(
        'label',
        null,
        'Deal title',
        ReactForMock.createElement('input', {
          value: values.title,
          'aria-invalid': errors.title ? true : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ title: event.target.value }),
        }),
        errors.title ? ReactForMock.createElement('span', null, errors.title) : null,
      ),
  }
})

jest.mock('../DealAssociationsField', () => ({
  DealAssociationsField: () => null,
}))

jest.mock('../DealCustomAttributes', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealCustomAttributes: ({
      values,
      onChange,
      errors,
      onLoaded,
    }: {
      values: Record<string, unknown>
      onChange: (key: string, value: unknown) => void
      errors?: Record<string, string>
      onLoaded?: (state: {
        fields: Array<{ id: string; label: string; type: string; required?: boolean }>
        definitions: typeof mockCustomDefinitions
      }) => void
    }) => {
      const loadedRef = ReactForMock.useRef(false)
      const fields = mockCustomDefinitions.map((definition) => ({
        id: `cf_${definition.key}`,
        label: definition.label ?? definition.key,
        type: 'text',
        required: definition.validation?.some((rule) => rule.rule === 'required') ?? false,
      }))
      ReactForMock.useEffect(() => {
        if (loadedRef.current) return
        loadedRef.current = true
        onLoaded?.({ fields, definitions: mockCustomDefinitions })
      }, [onLoaded, fields])

      return ReactForMock.createElement(
        'div',
        null,
        fields.map((field) =>
          ReactForMock.createElement(
            'label',
            { key: field.id },
            field.label,
            ReactForMock.createElement('input', {
              'aria-label': field.label,
              value: values[field.id] == null ? '' : String(values[field.id]),
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(field.id, event.target.value),
            }),
            errors?.[field.id] ? ReactForMock.createElement('span', null, errors[field.id]) : null,
          ),
        ),
      )
    },
  }
})

beforeEach(() => {
  injectionSpotProps.length = 0
  spotEventHookSpotIds.length = 0
  scopedHeaderCalls.length = 0
  mockCustomDefinitions = []
  mockPush.mockClear()
  mockCreateCrud.mockReset()
  mockCreateCrud.mockResolvedValue({ id: 'deal-1' })
  mockRunMutation.mockReset()
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  mockTriggerSpotEvent.mockReset()
  mockTriggerSpotEvent.mockResolvedValue({ ok: true })
})

const dispatchedSpotEvents = () => mockTriggerSpotEvent.mock.calls.map((call) => call[0] as string)

// The mock accumulates one entry per render, so read the newest — an early entry holds
// props captured before custom fields finished loading.
const renderedDealFormSpot = () =>
  [...injectionSpotProps].reverse().find((props) => props.spotId === extensionPoints.hosts.dealForm.spotId)

describe('CreateDealForm injection host (#5882)', () => {
  it('publishes the module\'s declared deal form spot so widgets reach the create surface', () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    expect(extensionPoints.hosts.dealForm.spotId).toBe('crud-form:customers.deal')
    expect(renderedDealFormSpot()).toBeDefined()
  })

  it('gives the spot a create-mode context in the shape CrudForm publishes', () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    expect(renderedDealFormSpot()?.context).toEqual({
      formId: 'customers.deals.create',
      entityId: 'customers:customer_deal',
      resourceKind: 'customers.deal',
      resourceId: undefined,
      recordId: undefined,
      isLoading: expect.any(Boolean),
      pending: false,
      operation: 'create',
    })
  })

  it('leaves recordId absent so record-scoped widgets can detect create mode', () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    const context = renderedDealFormSpot()?.context as Record<string, unknown>
    expect(context.recordId).toBeUndefined()
    expect(context.operation).toBe('create')
  })

  it('gives the spot the form values and a setter, as CrudForm does on edit', () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    const spot = renderedDealFormSpot()
    expect((spot?.data as Record<string, unknown>).title).toBe('Copperleaf renewal')

    act(() => {
      ;(spot?.onDataChange as (next: Record<string, unknown>) => void)({
        ...(spot?.data as Record<string, unknown>),
        title: 'Renamed by a widget',
      })
    })

    expect(screen.getByLabelText('Deal title')).toHaveValue('Renamed by a widget')
  })

  it('merges custom-field values into the data it hands widgets, as CrudForm does on edit', async () => {
    mockCustomDefinitions = [{ key: 'temperature', kind: 'text', label: 'Temperature', defaultValue: 'Warm' }]

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    await screen.findByLabelText('Temperature')
    await waitFor(() => {
      const data = renderedDealFormSpot()?.data as Record<string, unknown>
      expect(data.cf_temperature).toBe('Warm')
    })
    expect((renderedDealFormSpot()?.data as Record<string, unknown>).title).toBe('Copperleaf renewal')
  })

  it('routes a widget custom-field write back into custom values, not base form state', async () => {
    mockCustomDefinitions = [{ key: 'temperature', kind: 'text', label: 'Temperature', defaultValue: 'Warm' }]

    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await screen.findByLabelText('Temperature')

    act(() => {
      const spot = renderedDealFormSpot()
      ;(spot?.onDataChange as (next: Record<string, unknown>) => void)({
        ...(spot?.data as Record<string, unknown>),
        cf_temperature: 'Hot',
      })
    })

    await waitFor(() => expect(screen.getByLabelText('Temperature')).toHaveValue('Hot'))
  })
})

describe('CreateDealForm injection lifecycle (#5915 review)', () => {
  it('dispatches the save lifecycle on the declared deal host, in CrudForm order', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(spotEventHookSpotIds).toContain(extensionPoints.hosts.dealForm.spotId)
    expect(dispatchedSpotEvents()).toEqual(['onBeforeSave', 'onSave', 'onAfterSave'])
  })

  it('hands widgets the merged form state, including custom-field keys, on onBeforeSave', async () => {
    mockCustomDefinitions = [{ key: 'temperature', kind: 'text', label: 'Temperature', defaultValue: 'Warm' }]

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)
    await screen.findByLabelText('Temperature')

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    const [, data, context] = mockTriggerSpotEvent.mock.calls[0] as [string, Record<string, unknown>, Record<string, unknown>]
    expect(data.title).toBe('Copperleaf renewal')
    expect(data.cf_temperature).toBe('Warm')
    expect(context.operation).toBe('create')
    expect(context.recordId).toBeUndefined()
  })

  it('blocks the create when a widget refuses the save in onBeforeSave', async () => {
    mockTriggerSpotEvent.mockImplementation(async (event: string) =>
      event === 'onBeforeSave'
        ? { ok: false, message: 'Blocked by the compliance widget', fieldErrors: { title: 'Not allowed' } }
        : { ok: true },
    )

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    expect(await screen.findByText('Not allowed')).toBeInTheDocument()
    expect(mockCreateCrud).not.toHaveBeenCalled()
    expect(mockRunMutation).not.toHaveBeenCalled()
    expect(dispatchedSpotEvents()).toEqual(['onBeforeSave'])
  })

  it('applies request headers a widget returns from onBeforeSave to the create call', async () => {
    mockTriggerSpotEvent.mockImplementation(async (event: string) =>
      event === 'onBeforeSave' ? { ok: true, requestHeaders: { 'x-om-widget': 'deal-guard' } } : { ok: true },
    )

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(scopedHeaderCalls).toEqual([{ 'x-om-widget': 'deal-guard' }])
  })

  it('does not scope headers when no widget asks for any', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(scopedHeaderCalls).toEqual([])
  })

  it('keeps a completed create successful when a widget fails in onAfterSave', async () => {
    // `CrudForm` isolates its own `onAfterSave` dispatch, so a widget failing after the
    // write is logged and the save still succeeds. The create surface must not diverge:
    // the deal already exists, so reporting a failure and skipping the redirect would
    // strand the operator on a form whose record was in fact created.
    mockTriggerSpotEvent.mockImplementation(async (event: string) => {
      if (event === 'onAfterSave') throw new Error('widget exploded after the write')
      return { ok: true }
    })

    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Copperleaf renewal' }} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/backend/customers/deals'))
  })
})

describe('CreateDealForm', () => {
  it('starts with the existing empty values when initialValues is omitted', () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    expect(screen.getByLabelText('Deal title')).toHaveValue('')
  })

  it('prefills initialValues and includes them in the create payload', async () => {
    render(
      <CreateDealForm
        returnTo="/backend/customers/deals"
        initialValues={{
          title: 'Copperleaf renewal',
          status: 'active',
          valueCurrency: 'USD',
          description: 'Renewal seeded by the host application',
        }}
      />,
    )

    expect(screen.getByLabelText('Deal title')).toHaveValue('Copperleaf renewal')
    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    const expectedPayload = expect.objectContaining({
      title: 'Copperleaf renewal',
      status: 'active',
      valueCurrency: 'USD',
      description: 'Renewal seeded by the host application',
    })
    expect(mockCreateCrud).toHaveBeenCalledWith('customers/deals', expectedPayload, expect.any(Object))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({ mutationPayload: expectedPayload }))
  })

  it('ignores explicitly undefined initialValues entries', async () => {
    render(
      <CreateDealForm
        returnTo="/backend/customers/deals"
        initialValues={{ title: 'Copperleaf renewal', personIds: undefined }}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(mockCreateCrud).toHaveBeenCalledWith(
      'customers/deals',
      expect.objectContaining({ title: 'Copperleaf renewal', personIds: undefined }),
      expect.any(Object),
    )
  })

  it('applies custom-field defaults and passes the create payload to guarded mutation handlers', async () => {
    mockCustomDefinitions = [
      {
        key: 'temperature',
        kind: 'text',
        label: 'Temperature',
        defaultValue: 'Warm',
      },
    ]

    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    const customInput = await screen.findByLabelText('Temperature')
    await waitFor(() => expect(customInput).toHaveValue('Warm'))

    fireEvent.change(screen.getByLabelText('Deal title'), { target: { value: 'Copperleaf renewal' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    const expectedPayload = expect.objectContaining({
      title: 'Copperleaf renewal',
      customFields: { temperature: 'Warm' },
    })
    expect(mockCreateCrud).toHaveBeenCalledWith('customers/deals', expectedPayload, expect.any(Object))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({ mutationPayload: expectedPayload }))
  })

  it('blocks submit when a required custom field is empty', async () => {
    mockCustomDefinitions = [
      {
        key: 'priority',
        kind: 'text',
        label: 'Priority',
        validation: [{ rule: 'required', message: 'Priority is required' }],
      },
    ]

    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    await screen.findByLabelText('Priority')
    fireEvent.change(screen.getByLabelText('Deal title'), { target: { value: 'Copperleaf renewal' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    expect(await screen.findByText('Required')).toBeInTheDocument()
    expect(mockCreateCrud).not.toHaveBeenCalled()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })
})
