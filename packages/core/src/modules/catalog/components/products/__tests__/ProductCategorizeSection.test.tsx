/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProductCategorizeSection } from '../ProductCategorizeSection'
import type { ProductFormValues } from '../productForm'

const mockReadApiResultOrThrow = jest.fn()
const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

const mockUseBackendChrome = jest.fn()
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/BackendChromeProvider')
  return {
    ...actual,
    useBackendChrome: (...args: unknown[]) => (mockUseBackendChrome.getMockImplementation()
      ? mockUseBackendChrome(...args)
      : actual.useBackendChrome(...args)),
  }
})

jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({
  TagsInput: ({ value = [], placeholder, onChange, resolveLabel }: {
    value?: string[]
    placeholder?: string
    onChange?: (next: string[]) => void
    resolveLabel?: (id: string) => string
  }) => (
    <div
      data-testid={`tags-input-${placeholder}`}
      data-value={Array.isArray(value) ? value.join(',') : ''}
      data-labels={Array.isArray(value) ? value.map((id) => (resolveLabel ? resolveLabel(id) : id)).join(',') : ''}
    >
      <button data-testid={`trigger-${placeholder}`} type="button" onClick={() => onChange?.([...value, 'new-value'])}>
        add
      </button>
      {Array.isArray(value) ? value.join(',') : ''}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{?(\w+)\}\}?/g, (_, token: string) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

function createDefaultValues(overrides?: Partial<ProductFormValues>): ProductFormValues {
  return {
    title: '',
    subtitle: '',
    handle: '',
    sku: '',
    productType: 'simple',
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
    defaultUnit: null,
    defaultSalesUnit: null,
    defaultSalesUnitQuantity: '1',
    uomRoundingScale: '4',
    uomRoundingMode: 'half_up',
    unitPriceEnabled: false,
    unitPriceReferenceUnit: null,
    unitPriceBaseQuantity: '',
    unitConversions: [],
    customFieldsetCode: null,
    categoryIds: [],
    channelIds: [],
    tags: [],
    optionSchemaId: null,
    ...overrides,
  }
}

describe('ProductCategorizeSection', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('renders three TagsInput fields for categories, channels, and tags', () => {
    render(
      <ProductCategorizeSection values={createDefaultValues()} setValue={jest.fn()} errors={{}} />,
    )
    expect(screen.getByTestId('tags-input-Search categories')).toBeInTheDocument()
    expect(screen.getByTestId('tags-input-Pick channels')).toBeInTheDocument()
    expect(screen.getByTestId('tags-input-Add tag and press Enter')).toBeInTheDocument()
  })

  it('passes category ids to the categories TagsInput', () => {
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ categoryIds: ['cat-1', 'cat-2'] })}
        setValue={jest.fn()}
        errors={{}}
      />,
    )
    expect(screen.getByTestId('tags-input-Search categories')).toHaveAttribute('data-value', 'cat-1,cat-2')
  })

  it('passes channel ids to the channels TagsInput', () => {
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ channelIds: ['ch-1', 'ch-3'] })}
        setValue={jest.fn()}
        errors={{}}
      />,
    )
    expect(screen.getByTestId('tags-input-Pick channels')).toHaveAttribute('data-value', 'ch-1,ch-3')
  })

  it('passes tags to the tags TagsInput', () => {
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ tags: ['sale', 'new-arrival'] })}
        setValue={jest.fn()}
        errors={{}}
      />,
    )
    expect(screen.getByTestId('tags-input-Add tag and press Enter')).toHaveAttribute('data-value', 'sale,new-arrival')
  })

  it('calls setValue with categoryIds when categories onChange fires', () => {
    const setValue = jest.fn()
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ categoryIds: ['cat-1'] })}
        setValue={setValue}
        errors={{}}
      />,
    )
    fireEvent.click(screen.getByTestId('trigger-Search categories'))
    expect(setValue).toHaveBeenCalledWith('categoryIds', ['cat-1', 'new-value'])
  })

  it('calls setValue with channelIds when channels onChange fires', () => {
    const setValue = jest.fn()
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ channelIds: ['ch-1'] })}
        setValue={setValue}
        errors={{}}
      />,
    )
    fireEvent.click(screen.getByTestId('trigger-Pick channels'))
    expect(setValue).toHaveBeenCalledWith('channelIds', ['ch-1', 'new-value'])
  })

  it('calls setValue with tags when tags onChange fires', () => {
    const setValue = jest.fn()
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ tags: ['promo'] })}
        setValue={setValue}
        errors={{}}
      />,
    )
    fireEvent.click(screen.getByTestId('trigger-Add tag and press Enter'))
    expect(setValue).toHaveBeenCalledWith('tags', ['promo', 'new-value'])
  })

  it('renders labels for all three fields', () => {
    render(
      <ProductCategorizeSection values={createDefaultValues()} setValue={jest.fn()} errors={{}} />,
    )
    expect(screen.getByText('Categories')).toBeInTheDocument()
    expect(screen.getByText('Sales channels')).toBeInTheDocument()
    expect(screen.getByText('Tags')).toBeInTheDocument()
  })

  it('renders with empty arrays when no values are set', () => {
    render(
      <ProductCategorizeSection
        values={createDefaultValues({ categoryIds: [], channelIds: [], tags: [] })}
        setValue={jest.fn()}
        errors={{}}
      />,
    )
    expect(screen.getByTestId('tags-input-Search categories')).toHaveAttribute('data-value', '')
    expect(screen.getByTestId('tags-input-Pick channels')).toHaveAttribute('data-value', '')
    expect(screen.getByTestId('tags-input-Add tag and press Enter')).toHaveAttribute('data-value', '')
  })

  it('does not render the AI category suggestion card without a productId (draft product)', () => {
    render(
      <ProductCategorizeSection values={createDefaultValues()} setValue={jest.fn()} errors={{}} />,
    )
    expect(screen.queryByText('AI category suggestion')).not.toBeInTheDocument()
  })

  it('does not render the AI category suggestion card without catalog.ai_categorization.use (no BackendChromeProvider payload)', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ effective: false, items: [] })
    render(
      <ProductCategorizeSection
        values={createDefaultValues()}
        setValue={jest.fn()}
        errors={{}}
        productId="product-1"
      />,
    )
    await waitFor(() => {
      expect(screen.queryByText('AI category suggestion')).not.toBeInTheDocument()
    })
  })

  it('shows the names of the suggested categories instead of their ids, even when they are not assigned to the product', async () => {
    const rootId = '11111111-1111-4111-8111-111111111111'
    const childId = '22222222-2222-4222-8222-222222222222'
    const alternativeId = '33333333-3333-4333-8333-333333333333'
    mockUseBackendChrome.mockImplementation(() => ({
      payload: { grantedFeatures: ['catalog.ai_categorization.use'] },
      isReady: true,
    }))
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/catalog/ai-categorization/settings')) return { effective: true }
      if (url.startsWith('/api/catalog/category-suggestions')) {
        return {
          items: [{
            id: 's1',
            productId: 'product-1',
            outcome: 'suggested',
            categoryId: childId,
            categoryPathIds: [rootId, childId],
            confidence: 0.9,
            levels: [{
              categoryId: childId,
              probability: 0.9,
              alternatives: [{ categoryId: alternativeId, probability: 0.1 }],
            }],
            status: 'pending',
            updatedAt: '2026-11-02T10:00:00.000Z',
            categoryLive: true,
          }],
        }
      }
      if (url.startsWith('/api/catalog/categories')) {
        return {
          items: [
            { id: rootId, name: 'Electronics', pathLabel: 'Electronics' },
            { id: childId, name: 'Laptops', pathLabel: 'Electronics / Laptops' },
            { id: alternativeId, name: 'Smartphones', pathLabel: 'Electronics / Smartphones' },
          ],
        }
      }
      return { items: [] }
    })
    try {
      render(
        <ProductCategorizeSection
          values={createDefaultValues()}
          setValue={jest.fn()}
          errors={{}}
          productId="product-1"
          initialCategoryIds={[]}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText(/Electronics.*Laptops/)).toBeInTheDocument()
      })
      expect(screen.getByText(/Smartphones/)).toBeInTheDocument()
      expect(screen.queryByText(new RegExp(childId))).not.toBeInTheDocument()
      expect(screen.queryByText(new RegExp(rootId))).not.toBeInTheDocument()
    } finally {
      mockUseBackendChrome.mockReset()
    }
  })

  describe('suggestion card with category names', () => {
    const rootId = '11111111-1111-4111-8111-111111111111'
    const childId = '22222222-2222-4222-8222-222222222222'
    const alternativeId = '33333333-3333-4333-8333-333333333333'
    const pendingSuggestion = {
      id: 's1',
      productId: 'product-1',
      outcome: 'suggested',
      categoryId: childId,
      categoryPathIds: [rootId, childId],
      confidence: 0.9,
      levels: [{
        categoryId: childId,
        probability: 0.9,
        alternatives: [{ categoryId: alternativeId, probability: 0.1 }],
      }],
      status: 'pending',
      updatedAt: '2026-11-02T10:00:00.000Z',
      categoryLive: true,
    }
    const categoryRows = [
      { id: rootId, name: 'Sports & Outdoor', parentName: null, pathLabel: 'Sports & Outdoor' },
      { id: childId, name: 'Fitness', parentName: 'Sports & Outdoor', pathLabel: 'Sports & Outdoor / Fitness' },
      { id: alternativeId, name: 'Camping', parentName: 'Sports & Outdoor', pathLabel: 'Sports & Outdoor / Camping' },
    ]

    const mockSuggestionApis = (pending: unknown[]) => {
      mockUseBackendChrome.mockImplementation(() => ({
        payload: { grantedFeatures: ['catalog.ai_categorization.use'] },
        isReady: true,
      }))
      mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/catalog/ai-categorization/settings')) return { effective: true }
        if (url.startsWith('/api/catalog/category-suggestions')) return { items: pending }
        if (url.startsWith('/api/catalog/categories')) return { items: categoryRows }
        return { items: [] }
      })
    }

    afterEach(() => {
      mockUseBackendChrome.mockReset()
      mockApiCall.mockReset()
    })

    it('renders plain names for the path and alternatives when the product already has a category', async () => {
      mockSuggestionApis([pendingSuggestion])
      render(
        <ProductCategorizeSection
          values={createDefaultValues({ categoryIds: [childId] })}
          setValue={jest.fn()}
          errors={{}}
          productId="product-1"
          initialCategoryIds={[childId]}
          initialCategoryOptions={[{ value: childId, label: 'Fitness / Sports & Outdoor', description: 'Sports & Outdoor' }]}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('Sports & Outdoor / Fitness')).toBeInTheDocument()
      })
      expect(screen.getByText('Alternatives: Sports & Outdoor / Camping')).toBeInTheDocument()
      expect(screen.getByTestId('tags-input-Search categories')).toHaveAttribute('data-labels', 'Fitness / Sports & Outdoor')
    })

    it('shows the category name instead of the id in the Categories field after an automatic apply', async () => {
      mockSuggestionApis([])
      mockApiCall.mockResolvedValue({
        ok: true,
        result: {
          suggestion: { ...pendingSuggestion, status: 'auto_applied' },
          product: { id: 'product-1', categoryIds: [childId], updatedAt: '2026-11-02T11:00:00.000Z' },
        },
      })
      const Harness = () => {
        const [values, setValues] = React.useState(createDefaultValues())
        return (
          <ProductCategorizeSection
            values={values}
            setValue={(id, value) => setValues((previous) => ({ ...previous, [id]: value }))}
            errors={{}}
            productId="product-1"
            initialCategoryIds={[]}
          />
        )
      }
      render(<Harness />)
      fireEvent.click(await screen.findByRole('button', { name: 'Suggest category' }))
      await waitFor(() => {
        expect(screen.getByTestId('tags-input-Search categories')).toHaveAttribute('data-value', childId)
      })
      const field = screen.getByTestId('tags-input-Search categories')
      expect(field).toHaveAttribute('data-labels', 'Fitness / Sports & Outdoor')
      expect(field.getAttribute('data-labels')).not.toContain(childId)
    })
  })
})
