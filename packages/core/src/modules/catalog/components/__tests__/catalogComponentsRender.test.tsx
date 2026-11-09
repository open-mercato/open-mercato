/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// Radix Select / Radio use pointer capture / scrollIntoView APIs that jsdom doesn't implement.
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

// Mock Radix-based Radio primitives — keeps tests independent of Radix focus internals
jest.mock('@open-mercato/ui/primitives/radio', () => {
  const React2 = require('react') as typeof import('react')
  return {
    RadioGroup: ({ children, value, onValueChange, name }: any) => (
      <div role="radiogroup" data-value={value} data-name={name}>
        {React2.Children.map(children, (child: any) =>
          React2.cloneElement(child, { __groupValue: value, __onChange: onValueChange })
        )}
      </div>
    ),
    Radio: ({ value, __groupValue, __onChange, ...props }: any) => (
      <input
        type="radio"
        role="radio"
        value={value}
        checked={__groupValue === value}
        onChange={() => __onChange?.(value)}
        {...props}
      />
    ),
  }
})

import { PriceKindSettings } from '../PriceKindSettings'
import CategoriesDataTable from '../categories/CategoriesDataTable'
import { CategorySelect } from '../categories/CategorySelect'
import { CategorySlugFieldSync } from '../categories/CategorySlugFieldSync'
import { MetadataEditor } from '../products/MetadataEditor'
import { ProductCategorizeSection } from '../products/ProductCategorizeSection'
import { ProductMediaManager } from '../products/ProductMediaManager'
import ProductsDataTable from '../products/ProductsDataTable'
import { VariantBuilder } from '../products/VariantBuilder'
import { ServiceForm, buildServicePayload, createServiceInitialValues, normalizeServiceDefaultPriceAmount, normalizeServiceMediaItem } from '../services/ServiceForm'
import { ServiceWorkRequirements } from '../services/ServiceWorkRequirements'
import ServicesDataTable, { formatServiceDefaultPrice } from '../services/ServicesDataTable'
import type { VariantFormValues } from '../products/variantForm'
import type { ProductFormValues } from '../products/productForm'

const mockUseQuery = jest.fn()
const mockUseQueryClient = jest.fn()
jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useQueryClient: () => mockUseQueryClient(),
}))

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: any[]) => mockApiCallOrThrow(...args),
  readApiResultOrThrow: (...args: any[]) => mockReadApiResultOrThrow(...args),
}))

const mockDeleteCrud = jest.fn()
const mockBuildCrudExportUrl = jest.fn().mockReturnValue('/export')
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: (...args: any[]) => mockDeleteCrud(...args),
  buildCrudExportUrl: (...args: any[]) => mockBuildCrudExportUrl(...args),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>, sourceItem: Record<string, unknown>) => ({
    ...mappedRow,
    ...Object.fromEntries(Object.entries(sourceItem).filter(([key]) => key.startsWith('_'))),
  }),
  DataTable: ({ title, actions, children, data = [] }: any) => (
    <div data-testid="data-table">
      <h2>{title}</h2>
      <div>{actions}</div>
      <div data-testid="data-count">{Array.isArray(data) ? data.length : 0}</div>
      {children}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="row-actions">{children}</div>
  ),
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value?: boolean }) => <span>{value ? 'Yes' : 'No'}</span>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  return {
    CrudForm: ({ title, fields = [], groups = [], initialValues = {} }: any) => {
      const fieldsById = new Map(fields.map((field: any) => [field.id, field]))
      return (
        <form aria-label={title}>
          {groups.map((group: any) => (
            <section key={group.id}>
              <h2>{group.title}</h2>
              {(group.fields ?? []).map((fieldId: string) => {
                const field: any = fieldsById.get(fieldId)
                if (!field) return null
                const component = field.type === 'custom'
                  ? field.component({
                      id: field.id,
                      value: initialValues[field.id],
                      values: initialValues,
                      setValue: jest.fn(),
                      setFormValue: jest.fn(),
                    })
                  : null
                return (
                  <div key={field.id} data-testid={`crud-field-${field.id}`}>
                    {field.label?.trim?.() ? <label>{field.label}</label> : null}
                    {component}
                  </div>
                )
              })}
            </section>
          ))}
        </form>
      )
    },
  }
})

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string, fieldErrors?: Record<string, string>) => Object.assign(new Error(message), { fieldErrors }),
  raiseCrudError: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({
  TagsInput: ({ value = [], placeholder }: any) => (
    <div data-testid={`tags-input-${placeholder}`}>{Array.isArray(value) ? value.join(',') : ''}</div>
  ),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>
      {children}
    </button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: ({ children, ...props }: any) => <input {...props}>{children}</input>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactLib = require('react') as typeof import('react')
  const collectItems = (children: React.ReactNode): React.ReactElement[] => {
    const items: React.ReactElement[] = []
    ReactLib.Children.forEach(children, (child) => {
      if (!ReactLib.isValidElement(child)) return
      const props = child.props as { value?: string; children?: React.ReactNode }
      if (typeof props.value === 'string') items.push(<option key={props.value} value={props.value}>{props.children}</option>)
      else items.push(...collectItems(props.children))
    })
    return items
  }
  return {
    __esModule: true,
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (next: string) => void; children?: React.ReactNode }) => (
      <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>{collectItems(children)}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
  }
})

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (next: boolean) => void }) => (
    <input
      role="switch"
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h3>{children}</h3>,
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [] }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldColumns', () => ({
  applyCustomFieldVisibility: (_columns: any) => _columns,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: ({
    value,
    onChange,
    fetchOptions,
  }: {
    value?: string | null
    onChange?: (value: string | null) => void
    fetchOptions?: () => Promise<Array<{ value: string; label: string }>>
  }) => {
    const React2 = require('react') as typeof import('react')
    const [options, setOptions] = React2.useState<Array<{ value: string; label: string }>>([])
    React2.useEffect(() => {
      fetchOptions?.().then(setOptions).catch(() => setOptions([]))
    }, [fetchOptions])
    return (
    <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value || null)}>
      <option value="">Select</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    )
  },
}))

jest.mock('../../lib/currencyOptions', () => ({
  loadCurrencyOptions: jest.fn().mockResolvedValue([
    { value: 'GBP', label: 'Pound Sterling', color: null, icon: null },
    { value: 'PLN', label: 'Polish Zloty', color: null, icon: null },
  ]),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) {
      return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    }
    return base
  }
  return {
    useT: () => translate,
    useLocale: () => 'en',
  }
})

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/core/modules/attachments/lib/imageUrls', () => ({
  buildAttachmentImageUrl: (id: string) => `https://cdn.local/${id}.jpg`,
  slugifyAttachmentFileName: (name: string) => name,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

globalThis.confirm = jest.fn(() => true)

describe('catalog module components', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseQuery.mockReset().mockReturnValue({ data: { items: [], total: 0, totalPages: 1 }, isLoading: false })
    mockUseQueryClient.mockReset().mockReturnValue({ invalidateQueries: jest.fn() })
    mockApiCall.mockReset().mockResolvedValue({ ok: true, result: { ok: true } })
    mockApiCallOrThrow.mockReset().mockResolvedValue({})
    mockReadApiResultOrThrow.mockReset().mockResolvedValue({ items: [] })
    mockDeleteCrud.mockReset()
    mockBuildCrudExportUrl.mockClear()
  })

  it('renders PriceKindSettings with loaded rows', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({
      items: [{ id: 'price-kind-1', code: 'retail', title: 'Retail', displayMode: 'excluding-tax' }],
    })
    render(<PriceKindSettings />)
    await waitFor(() => expect(screen.getByTestId('data-count')).toHaveTextContent('1'))
    expect(screen.getByText(/Add price kind/i)).toBeInTheDocument()
  })

  it('renders CategoriesDataTable rows and create button', async () => {
    mockUseQuery.mockReturnValue({
      data: {
        items: [
          {
            id: 'cat-1',
            name: 'Footwear',
            pathLabel: 'Store / Footwear',
            parentName: 'Store',
            childCount: 2,
            isActive: true,
            depth: 0,
          },
        ],
        total: 1,
        totalPages: 1,
      },
      isLoading: false,
    })
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { ok: true, granted: ['catalog.categories.manage'] },
    })
    render(<CategoriesDataTable />)
    await waitFor(() => expect(screen.getByTestId('data-count')).toHaveTextContent('1'))
    expect(screen.getByText(/Categories/i)).toBeInTheDocument()
  })

  it('renders CategorySelect with provided nodes', () => {
    const handleChange = jest.fn()
    const nodes = [
      { id: 'cat-1', name: 'Shoes', depth: 0, children: [], pathLabel: 'Root / Shoes', isActive: false },
    ]
    render(
      <CategorySelect
        value="cat-1"
        onChange={handleChange}
        nodes={nodes}
      />,
    )
    const option = screen.getByRole('option', { name: /Shoes/i })
    expect(option).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cat-1' } })
    expect(handleChange).toHaveBeenCalledWith('cat-1')
  })

  it('syncs category slug automatically', async () => {
    const setValue = jest.fn()
    const { rerender } = render(
      <CategorySlugFieldSync
        values={{ name: '', slug: '' }}
        errors={{}}
        setValue={setValue}
      />,
    )
    rerender(
      <CategorySlugFieldSync
        values={{ name: 'Summer Hat', slug: '' }}
        errors={{}}
        setValue={setValue}
      />,
    )
    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('slug', 'summer-hat')
    })
  })

  it('renders MetadataEditor entries when expanded', () => {
    const handleChange = jest.fn()
    render(
      <MetadataEditor
        value={{ material: 'Cotton' }}
        onChange={handleChange}
        defaultCollapsed={false}
        title="Metadata"
      />,
    )
    expect(screen.getByDisplayValue('material')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cotton')).toBeInTheDocument()
  })

  it('renders ProductCategorizeSection inputs', () => {
    const setValue = jest.fn()
    const values: ProductFormValues = {
      title: '',
      subtitle: '',
      handle: '',
      description: '',
      useMarkdown: false,
      taxRateId: null,
      mediaDraftId: 'draft',
      mediaItems: [],
      defaultMediaId: null,
      defaultMediaUrl: '',
      hasVariants: false,
      options: [],
      variants: [],
      metadata: {},
      dimensions: null,
      weight: null,
      customFieldsetCode: null,
      categoryIds: ['cat-1'],
      channelIds: ['ch-1'],
      tags: ['featured'],
      optionSchemaId: null,
      defaultUnit: null,
      defaultSalesUnit: null,
      defaultSalesUnitQuantity: '1',
      uomRoundingScale: '4',
      uomRoundingMode: 'half_up',
      unitPriceEnabled: false,
      unitPriceReferenceUnit: null,
      unitPriceBaseQuantity: '',
      unitConversions: [],
    }
    render(<ProductCategorizeSection values={values} setValue={setValue} errors={{}} />)
    expect(screen.getByText(/Categories/)).toBeInTheDocument()
    expect(screen.getByTestId('tags-input-Search categories')).toBeInTheDocument()
    expect(screen.getByTestId('tags-input-Pick channels')).toBeInTheDocument()
    expect(screen.getByTestId('tags-input-Add tag and press Enter')).toBeInTheDocument()
  })

  it('renders ProductMediaManager gallery items', () => {
    render(
      <ProductMediaManager
        entityId="catalog.product"
        draftRecordId="draft-1"
        items={[{ id: 'att-1', url: '', fileName: 'main.jpg', fileSize: 1024, thumbnailUrl: null }]}
        defaultMediaId="att-1"
        onItemsChange={jest.fn()}
        onDefaultChange={jest.fn()}
      />,
    )
    expect(screen.getByText(/Media/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /main\.jpg/i })).toBeInTheDocument()
  })

  it('renders ServiceForm without duplicate media/work headings and normalizes trailing-zero price scale', async () => {
    render(
      <ServiceForm
        title="Edit service"
        submitLabel="Save"
        initialValues={createServiceInitialValues({
          title: 'Regression service',
          defaultPriceAmount: '6767.0000',
          defaultPriceCurrencyCode: 'USD',
        })}
        onSubmit={jest.fn()}
      />,
    )

    expect(screen.getAllByText('Media')).toHaveLength(1)
    expect(screen.getAllByText('Work requirements')).toHaveLength(1)
    expect(screen.getByDisplayValue('6767.00')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: 'USD' })).toBeInTheDocument())
  })

  it('starts new services without a hidden default currency selection', () => {
    expect(createServiceInitialValues().defaultPriceCurrencyCode).toBe('')
    const t = (_key: string, fallback?: string) => fallback ?? _key
    expect(() => buildServicePayload(createServiceInitialValues({
      title: 'Needs currency',
      defaultPriceAmount: '10',
      defaultPriceCurrencyCode: '',
    }), t)).toThrow(/price and currency/)
  })

  it('formats service default prices as money labels instead of raw storage scale', () => {
    const formatted = formatServiceDefaultPrice('6767.0000', 'USD')
    expect(formatted).not.toContain('0000')
    expect(formatted).toBe('USD 6,767.00')
    expect(formatServiceDefaultPrice('495.0000', 'GBP', '—', 'en')).toBe('GBP 495.00')
    expect(normalizeServiceDefaultPriceAmount('6767.1200')).toBe('6767.12')
    expect(normalizeServiceDefaultPriceAmount('6767.1234')).toBe('6767.1234')
  })

  it('does not invent a zero-byte service media size when the API omits size metadata', () => {
    const item = normalizeServiceMediaItem({
      id: 'att-1',
      fileName: 'scope.png',
      url: 'https://cdn.local/scope.png',
    })
    expect(item).toEqual(expect.objectContaining({
      id: 'att-1',
      fileName: 'scope.png',
    }))
    expect(item?.fileSize).toBeUndefined()
  })

  it('allows integer and decimal work requirement allocation values', () => {
    const handleChange = jest.fn()
    render(
      <ServiceWorkRequirements
        value={[
          {
            targetType: 'generic',
            targetId: null,
            labelSnapshot: 'Solution Consultant',
            allocationMode: 'ratio',
            allocationValue: '1',
            sortOrder: 0,
          },
          {
            targetType: 'generic',
            targetId: null,
            labelSnapshot: 'Project Manager',
            allocationMode: 'fixed_hours',
            allocationValue: '10',
            sortOrder: 1,
          },
          {
            targetType: 'generic',
            targetId: null,
            labelSnapshot: 'Implementation Specialist',
            allocationMode: 'ratio',
            allocationValue: '0.2',
            sortOrder: 2,
          },
        ]}
        onChange={handleChange}
      />,
    )

    const valueInput = screen.getByDisplayValue('10') as HTMLInputElement
    expect(valueInput.type).toBe('text')
    fireEvent.change(valueInput, { target: { value: '4' } })
    expect(handleChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ labelSnapshot: 'Project Manager', allocationValue: '4' }),
    ]))
  })

  it('uses human labels for work requirement references from snake_case API fields', async () => {
    const handleChange = jest.fn()
    const memberId = 'f818c729-3cac-4e19-9655-cd605abe6079'
    mockApiCall.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: url === '/api/auth/feature-check'
        ? { granted: ['staff.view', 'resources.view'] }
        : {
            items: url.startsWith('/api/staff/team-members')
              ? [{ id: memberId, display_name: 'Filip Kubala' }]
              : [],
          },
    }))

    render(
      <ServiceWorkRequirements
        value={[{
          targetType: 'staff_member',
          targetId: null,
          labelSnapshot: '',
          allocationMode: 'ratio',
          allocationValue: '0.3',
          sortOrder: 0,
        }]}
        onChange={handleChange}
      />,
    )

    await waitFor(() => expect(screen.getByRole('option', { name: 'Filip Kubala' })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: memberId })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: memberId } })
    expect(handleChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ targetId: memberId, labelSnapshot: 'Filip Kubala' }),
    ]))
  })

  it('keeps showing a saved reference that is not among the loaded options', async () => {
    const savedMemberId = '3f1d2c4b-5a6e-4f70-8a91-b2c3d4e5f607'
    const loadedMemberId = 'f818c729-3cac-4e19-9655-cd605abe6079'
    mockApiCall.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: url === '/api/auth/feature-check'
        ? { granted: ['staff.view'] }
        : {
            items: url.startsWith('/api/staff/team-members')
              ? [{ id: loadedMemberId, display_name: 'Filip Kubala' }]
              : [],
          },
    }))

    render(
      <ServiceWorkRequirements
        value={[
          {
            targetType: 'staff_member',
            targetId: savedMemberId,
            labelSnapshot: 'Anna Nowak',
            allocationMode: 'ratio',
            allocationValue: '1',
            sortOrder: 0,
          },
          {
            targetType: 'staff_member',
            targetId: savedMemberId,
            labelSnapshot: '',
            allocationMode: 'ratio',
            allocationValue: '1',
            sortOrder: 1,
          },
        ]}
        onChange={jest.fn()}
      />,
    )

    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Filip Kubala' })).toHaveLength(2))
    const [labelledSelect, unlabelledSelect] = screen.getAllByLabelText('Reference') as HTMLSelectElement[]
    expect(labelledSelect.value).toBe(savedMemberId)
    expect(labelledSelect.selectedOptions[0]?.textContent).toBe('Anna Nowak')
    expect(unlabelledSelect.value).toBe(savedMemberId)
    expect(unlabelledSelect.selectedOptions[0]?.textContent).toBe('#3f1d2c4b')
  })

  it('lays work requirements out on a two-column grid without arbitrary values', () => {
    const { container } = render(
      <ServiceWorkRequirements
        value={[
          { targetType: 'generic', targetId: null, labelSnapshot: 'Setup', allocationMode: 'ratio', allocationValue: '1', sortOrder: 0 },
          { targetType: 'staff_member', targetId: null, labelSnapshot: '', allocationMode: 'ratio', allocationValue: '1', sortOrder: 1 },
        ]}
        onChange={jest.fn()}
      />,
    )

    const grids = Array.from(container.querySelectorAll('.grid'))
    expect(grids).toHaveLength(2)
    for (const grid of grids) {
      expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
      expect(grid.className).not.toContain('[')
      for (const cell of Array.from(grid.children)) {
        expect(cell.className).not.toContain('[')
      }
    }
    const [genericGrid, staffGrid] = grids
    expect(genericGrid.children).toHaveLength(5)
    expect(genericGrid.lastElementChild).toHaveClass('sm:col-span-2')
    expect(staffGrid.children).toHaveLength(6)
    expect(staffGrid.lastElementChild).not.toHaveClass('sm:col-span-2')
  })

  it('only loads work requirement references the user may read, without forbidden redirects', async () => {
    mockApiCall.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: url === '/api/auth/feature-check' ? { granted: ['resources.view'] } : { items: [] },
    }))

    render(
      <ServiceWorkRequirements
        value={[{
          targetType: 'resource',
          targetId: null,
          labelSnapshot: 'Studio',
          allocationMode: 'ratio',
          allocationValue: '1',
          sortOrder: 0,
        }]}
        onChange={jest.fn()}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      expect.stringContaining('/api/resources/resource-types'),
      expect.anything(),
    ))
    const requestedUrls = mockApiCall.mock.calls.map(([url]) => String(url))
    expect(requestedUrls.some((url) => url.startsWith('/api/staff/'))).toBe(false)
    expect(requestedUrls.filter((url) => url.startsWith('/api/resources/'))).toHaveLength(2)
    for (const [, init] of mockApiCall.mock.calls) {
      expect(init).toEqual(expect.objectContaining({
        headers: expect.objectContaining({ 'x-om-forbidden-redirect': '0' }),
      }))
    }
  })

  it('skips every reference lookup when the user may read neither staff nor resources', async () => {
    mockApiCall.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: url === '/api/auth/feature-check' ? { granted: [] } : { items: [] },
    }))

    render(
      <ServiceWorkRequirements
        value={[]}
        onChange={jest.fn()}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('/api/auth/feature-check', expect.anything()))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })

  it('allows staff work requirements to use an explicit label without selecting a reference', () => {
    const handleChange = jest.fn()

    render(
      <ServiceWorkRequirements
        value={[{
          targetType: 'staff_member',
          targetId: null,
          labelSnapshot: '',
          allocationMode: 'fixed_hours',
          allocationValue: '10',
          sortOrder: 0,
        }]}
        onChange={handleChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lead designer' } })

    expect(handleChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ targetId: null, labelSnapshot: 'Lead designer' }),
    ]))
  })

  it('shows the create action when a wildcard grant covers catalog.services.manage', async () => {
    mockApiCall.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: url === '/api/auth/feature-check' ? { ok: false, granted: ['catalog.*'] } : { items: [] },
    }))

    render(<ServicesDataTable />)

    expect(await screen.findByRole('link', { name: 'Create' })).toHaveAttribute('href', '/backend/catalog/services/create')
  })

  it('hides the create action without the manage feature', async () => {
    mockApiCall.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: url === '/api/auth/feature-check' ? { ok: false, granted: ['catalog.services.view'] } : { items: [] },
    }))

    render(<ServicesDataTable />)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('/api/auth/feature-check', expect.anything()))
    expect(screen.queryByRole('link', { name: 'Create' })).not.toBeInTheDocument()
  })

  it('parses locale decimals typed into the default price and work requirements', () => {
    const t = (_key: string, fallback?: string) => fallback ?? _key
    const payload = buildServicePayload(createServiceInitialValues({
      title: 'Workshop',
      defaultPriceAmount: '12,50',
      defaultPriceCurrencyCode: 'PLN',
      workRequirements: [{
        targetType: 'generic',
        targetId: null,
        labelSnapshot: 'Consultant',
        allocationMode: 'fixed_hours',
        allocationValue: '1,5',
      }],
    }), t)

    expect(payload.defaultPriceAmount).toBe('12.5')
    expect(payload.workRequirements).toEqual([
      expect.objectContaining({ allocationValue: 1.5 }),
    ])
  })

  it('rejects an unreadable or negative default price before submit', () => {
    const t = (_key: string, fallback?: string) => fallback ?? _key
    for (const defaultPriceAmount of ['abc', '-5']) {
      expect(() => buildServicePayload(createServiceInitialValues({
        title: 'Workshop',
        defaultPriceAmount,
        defaultPriceCurrencyCode: 'USD',
      }), t)).toThrow('Provide a valid, non-negative default price.')
    }
  })

  it('maps valid integer work requirements and rejects invalid values before submit', () => {
    const t = (_key: string, fallback?: string) => fallback ?? _key
    const valid = buildServicePayload(createServiceInitialValues({
      title: 'Valid service',
      defaultPriceAmount: '',
      defaultPriceCurrencyCode: 'USD',
      workRequirements: [{
        targetType: 'generic',
        targetId: null,
        labelSnapshot: 'Project Manager',
        allocationMode: 'fixed_hours',
        allocationValue: '4',
      }],
    }), t)
    expect(valid.workRequirements).toEqual([
      expect.objectContaining({ labelSnapshot: 'Project Manager', allocationValue: 4 }),
    ])

    expect(() => buildServicePayload(createServiceInitialValues({
      title: 'Invalid service',
      workRequirements: [{
        targetType: 'generic',
        targetId: null,
        labelSnapshot: 'Project Manager',
        allocationMode: 'fixed_hours',
        allocationValue: '',
      }],
    }), t)).toThrow(/positive value/)
  })

  it('renders ProductsDataTable rows', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          {
            id: 'prod-1',
            title: 'Sneaker',
            default_media_id: null,
            offers: [],
            pricing: null,
          },
        ],
        total: 1,
        totalPages: 1,
      },
    })
    render(<ProductsDataTable />)
    await waitFor(() => expect(screen.getByTestId('data-count')).toHaveTextContent('1'))
  })

  it('renders VariantBuilder form sections', () => {
    const values: VariantFormValues = {
      name: 'Variant A',
      sku: 'SKU-A',
      barcode: '123456',
      isDefault: true,
      isActive: true,
      optionValues: { color: 'Red' },
      metadata: {},
      mediaDraftId: 'draft-variant',
      mediaItems: [],
      defaultMediaId: null,
      defaultMediaUrl: '',
      prices: {
        'kind-1': { priceKindId: 'kind-1', amount: '10', currencyCode: 'USD', displayMode: 'excluding-tax' },
      },
      taxRateId: 'rate-1',
      customFieldsetCode: null,
    }
    render(
      <VariantBuilder
        values={values}
        setValue={jest.fn()}
        errors={{}}
        optionDefinitions={[
          { id: 'opt-1', code: 'color', label: 'Color', values: [{ id: 'red', label: 'Red' }] },
        ]}
        priceKinds={[{ id: 'kind-1', code: 'retail', title: 'Retail', currencyCode: 'USD', displayMode: 'excluding-tax' }]}
        taxRates={[{ id: 'rate-1', name: 'Standard', code: 'STD', rate: 20, isDefault: true }]}
      />,
    )
    expect(screen.getByText(/Name/)).toBeInTheDocument()
    expect(screen.getByText(/Option values/)).toBeInTheDocument()
    expect(screen.getByText(/Dimensions/)).toBeInTheDocument()
    expect(screen.getAllByText(/Media/).length).toBeGreaterThan(0)
  })
})
