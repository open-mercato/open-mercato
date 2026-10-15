/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID } from '@open-mercato/ui/backend/injection/mutationEvents'
import type { InjectionFieldWidget, InjectionWidgetModule, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'


const mockPush = jest.fn()
const mockCreateCrud = jest.fn()
const mockGlobalBeforeSave = jest.fn()
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

jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: async () => ({ definitions: mockCustomDefinitions.map((definition) => ({ ...definition, entityId: 'customers:customer_deal' })), metadata: {} }),
}))
jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldDefs'),
  fetchCustomFieldDefs: async () => mockCustomDefinitions.map((definition) => ({ ...definition, entityId: 'customers:customer_deal' })),
}))
jest.mock('@open-mercato/ui/backend/fields/registry', () => ({ ...jest.requireActual('@open-mercato/ui/backend/fields/registry'), loadGeneratedFieldRegistrations: async () => {} }))

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
    }).passthrough(),
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

function register(widgets: Array<InjectionFieldWidget | InjectionWidgetModule>, table: ModuleInjectionTable) {
  const entries: ModuleInjectionWidgetEntry[] = widgets.map((widget) => ({ moduleId: 'extension', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package', loader: async () => widget }))
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'extension', table }], entries)
  registerEnabledModuleIds(['customers', 'extension'])
}

afterEach(() => { register([], {}) })

beforeEach(() => {
  mockCustomDefinitions = []
  mockPush.mockClear()
  mockCreateCrud.mockReset()
  mockCreateCrud.mockResolvedValue({ result: { id: 'deal-1' } })
  mockGlobalBeforeSave.mockReset()
  register([], {})
})

describe('CreateDealForm', () => {
  it('starts with the existing empty values when initialValues is omitted', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create deal' })).toBeEnabled())
    expect(screen.getByLabelText(/Deal title/)).toHaveValue('')
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

    expect(screen.getByLabelText(/Deal title/)).toHaveValue('Copperleaf renewal')
    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    const expectedPayload = expect.objectContaining({
      title: 'Copperleaf renewal',
      status: 'active',
      valueCurrency: 'USD',
      description: 'Renewal seeded by the host application',
    })
    expect(mockCreateCrud).toHaveBeenCalledWith('customers/deals', expectedPayload, expect.any(Object))
    expect(document.querySelectorAll('form')).toHaveLength(1)
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

    fireEvent.change(screen.getByLabelText(/Deal title/), { target: { value: 'Copperleaf renewal' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    const expectedPayload = expect.objectContaining({
      title: 'Copperleaf renewal',
      customFields: { temperature: 'Warm' },
    })
    expect(mockCreateCrud).toHaveBeenCalledWith('customers/deals', expectedPayload, expect.any(Object))
    expect(document.querySelectorAll('form')).toHaveLength(1)
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
    fireEvent.change(screen.getByLabelText(/Deal title/), { target: { value: 'Copperleaf renewal' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])

    expect(await screen.findByText('ui.forms.errors.required')).toBeInTheDocument()
    expect(mockCreateCrud).not.toHaveBeenCalled()
    expect(mockGlobalBeforeSave).not.toHaveBeenCalled()
  })
})

it('validates headless fields, runs the global guard once and waits for create after-save before navigating', async () => {
  let finishContribution: () => void = () => {}
  const contribution = new Promise<void>((resolve) => { finishContribution = resolve })
  const afterSave = jest.fn(async (_values: Record<string, unknown>, context: Record<string, unknown>) => {
    expect(context.resourceKind).toBe('customers.deal')
    expect(context.resourceId).toBe('deal-1')
    await contribution
  })
  const beforeSave = jest.fn(async (values: Record<string, unknown>) => values['_extension.priority'] === 'blocked' ? { ok: false, fieldErrors: { '_extension.priority': 'Priority blocked' } } : true)
  const extension: InjectionFieldWidget = {
    metadata: { id: 'extension.priority' },
    fields: [{ id: '_extension.priority', label: 'Extension priority', type: 'text', group: 'details' }],
    eventHandlers: { onBeforeSave: beforeSave, onAfterSave: afterSave },
  }
  const guard: InjectionWidgetModule = {
    metadata: { id: 'extension.guard', title: 'Guard' },
    Widget: () => <span>Guard</span>,
    eventHandlers: { onBeforeSave: mockGlobalBeforeSave },
  }
  register([extension, guard], { 'crud-form:customers.deal:fields': 'extension.priority', [GLOBAL_MUTATION_INJECTION_SPOT_ID]: 'extension.guard' })
  const { container } = render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Native title' }} />)
  const priority = await screen.findByLabelText('Extension priority')
  fireEvent.change(priority, { target: { value: 'blocked' } })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('Priority blocked')
  expect(mockCreateCrud).not.toHaveBeenCalled()
  fireEvent.change(priority, { target: { value: 'high' } })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(afterSave).toHaveBeenCalledTimes(1))
  expect(mockCreateCrud).toHaveBeenCalledTimes(1)
  expect(mockCreateCrud.mock.calls[0][1]).not.toHaveProperty('_extension')
  expect(mockCreateCrud.mock.calls[0][1]).not.toHaveProperty('_extension.priority')
  expect(mockPush).not.toHaveBeenCalled()
  await act(async () => finishContribution())
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/backend/customers/deals'))
  expect(mockGlobalBeforeSave).toHaveBeenCalledTimes(1)
  expect(container.querySelectorAll('form')).toHaveLength(1)
})

it('submits the authoritative form values with Ctrl+Enter and cancels without another native create', async () => {
  render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Initial' }} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create deal' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText(/Deal title/), { target: { value: 'Keyboard edit' } })
  fireEvent.keyDown(screen.getByLabelText(/Deal title/), { key: 'Enter', ctrlKey: true })
  await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
  expect(mockCreateCrud.mock.calls[0][1]).toEqual(expect.objectContaining({ title: 'Keyboard edit' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(mockPush).toHaveBeenCalledTimes(2)
  expect(mockCreateCrud).toHaveBeenCalledTimes(1)
})

it('surfaces native submission field errors and keeps the create form open', async () => {
  mockCreateCrud.mockRejectedValue(createCrudFormError('Native rejection', { title: 'Title rejected' }))
  render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ title: 'Valid title' }} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create deal' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Create deal' }))
  await screen.findByText('Title rejected')
  expect(mockPush).not.toHaveBeenCalled()
  expect(screen.getByLabelText(/Deal title/)).toHaveAttribute('aria-invalid', 'true')
})
