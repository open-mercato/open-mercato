/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'

const mockPush = jest.fn()
const mockCreateCrud = jest.fn()
const mockRunMutation = jest.fn()
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
  mockCustomDefinitions = []
  mockPush.mockClear()
  mockCreateCrud.mockReset()
  mockCreateCrud.mockResolvedValue({ id: 'deal-1' })
  mockRunMutation.mockReset()
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
})

describe('CreateDealForm custom fields', () => {
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
