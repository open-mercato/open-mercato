/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProductCategorizeSection } from '../ProductCategorizeSection'
import type { ProductFormValues } from '../productForm'

const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({
  TagsInput: ({ value = [], placeholder, onChange }: {
    value?: string[]
    placeholder?: string
    onChange?: (next: string[]) => void
  }) => (
    <div data-testid={`tags-input-${placeholder}`} data-value={Array.isArray(value) ? value.join(',') : ''}>
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
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(vars[token] ?? ''))
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
})
