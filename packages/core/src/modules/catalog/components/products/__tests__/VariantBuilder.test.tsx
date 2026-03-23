/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  VariantBuilder,
  VariantBasicsSection,
  VariantOptionValuesSection,
  VariantDimensionsSection,
  VariantPricesSection,
  VariantMediaSection,
} from '../VariantBuilder'
import type { VariantFormValues } from '../variantForm'
import type { PriceKindSummary, TaxRateSummary } from '../productForm'
import type { OptionDefinition } from '../variantForm'

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
jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))
jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean
    onCheckedChange?: (next: boolean) => void
  }) => (
    <input
      role="switch"
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

jest.mock('../ProductMediaManager', () => ({
  ProductMediaManager: (props: Record<string, unknown>) => (
    <div data-testid="product-media-manager" data-entity-id={props.entityId} />
  ),
}))
jest.mock('../MetadataEditor', () => ({
  MetadataEditor: () => <div data-testid="metadata-editor" />,
}))

jest.mock('#generated/entities.ids.generated', () => ({ E: { catalog: { catalog_product_variant: 'mock-variant-entity-id' } } }), {
  virtual: true,
})

function createDefaultValues(overrides?: Partial<VariantFormValues>): VariantFormValues {
  return {
    name: '',
    sku: '',
    barcode: '',
    isDefault: false,
    isActive: true,
    optionValues: {},
    metadata: {},
    mediaDraftId: 'draft-123',
    mediaItems: [],
    defaultMediaId: null,
    defaultMediaUrl: '',
    prices: {},
    taxRateId: null,
    customFieldsetCode: null,
    ...overrides,
  }
}

function createPriceKinds(): PriceKindSummary[] {
  return [
    { id: 'pk-1', code: 'retail', title: 'Retail', currencyCode: 'eur', displayMode: 'excluding-tax' },
    { id: 'pk-2', code: 'wholesale', title: 'Wholesale', currencyCode: 'usd', displayMode: 'including-tax' },
  ]
}

function createTaxRates(): TaxRateSummary[] {
  return [
    { id: 'tax-1', name: 'Standard', code: 'std', rate: 20, isDefault: true },
    { id: 'tax-2', name: 'Reduced', code: 'red', rate: 10, isDefault: false },
  ]
}

function createOptionDefinitions(): OptionDefinition[] {
  return [
    {
      id: 'opt-1',
      code: 'color',
      label: 'Color',
      values: [
        { id: 'v-red', label: 'Red' },
        { id: 'v-blue', label: 'Blue' },
      ],
    },
    {
      id: 'opt-2',
      code: 'size',
      label: 'Size',
      values: [
        { id: 'v-sm', label: 'Small' },
        { id: 'v-lg', label: 'Large' },
      ],
    },
  ]
}

describe('VariantBasicsSection', () => {
  it('renders name input with placeholder', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues()} setValue={setValue} errors={{}} />)
    const nameInput = screen.getByPlaceholderText('e.g., Blue / Small')
    expect(nameInput).toBeInTheDocument()
  })

  it('renders SKU and barcode inputs', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues()} setValue={setValue} errors={{}} />)
    expect(screen.getByPlaceholderText('Unique identifier')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('EAN, UPC, etc.')).toBeInTheDocument()
  })

  it('displays name value from form values', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues({ name: 'Blue / Small' })} setValue={setValue} errors={{}} />)
    const nameInput = screen.getByPlaceholderText('e.g., Blue / Small') as HTMLInputElement
    expect(nameInput.value).toBe('Blue / Small')
  })

  it('calls setValue when name input changes', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues()} setValue={setValue} errors={{}} />)
    const nameInput = screen.getByPlaceholderText('e.g., Blue / Small')
    fireEvent.change(nameInput, { target: { value: 'Green / Medium' } })
    expect(setValue).toHaveBeenCalledWith('name', 'Green / Medium')
  })

  it('renders isDefault and isActive switch toggles', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues()} setValue={setValue} errors={{}} />)
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
  })

  it('calls setValue when isDefault switch is toggled', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues({ isDefault: false })} setValue={setValue} errors={{}} />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    expect(setValue).toHaveBeenCalledWith('isDefault', true)
  })

  it('displays error message when name has error', () => {
    const setValue = jest.fn()
    render(<VariantBasicsSection values={createDefaultValues()} setValue={setValue} errors={{ name: 'Name is required' }} />)
    expect(screen.getByText('Name is required')).toBeInTheDocument()
  })
})

describe('VariantOptionValuesSection', () => {
  it('renders nothing when optionDefinitions is empty', () => {
    const setValue = jest.fn()
    const { container } = render(
      <VariantOptionValuesSection values={createDefaultValues()} setValue={setValue} optionDefinitions={[]} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders select elements for each option definition', () => {
    const setValue = jest.fn()
    render(
      <VariantOptionValuesSection
        values={createDefaultValues()}
        setValue={setValue}
        optionDefinitions={createOptionDefinitions()}
      />,
    )
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
  })

  it('calls setValue with merged optionValues when select changes', () => {
    const setValue = jest.fn()
    render(
      <VariantOptionValuesSection
        values={createDefaultValues()}
        setValue={setValue}
        optionDefinitions={createOptionDefinitions()}
      />,
    )
    const selects = document.querySelectorAll('select')
    fireEvent.change(selects[0], { target: { value: 'Red' } })
    expect(setValue).toHaveBeenCalledWith('optionValues', { color: 'Red' })
  })
})

describe('VariantDimensionsSection', () => {
  it('renders dimension inputs for width, height, depth, weight', () => {
    const setValue = jest.fn()
    render(<VariantDimensionsSection values={createDefaultValues()} setValue={setValue} />)
    expect(screen.getByText('Width')).toBeInTheDocument()
    expect(screen.getByText('Height')).toBeInTheDocument()
    expect(screen.getByText('Depth')).toBeInTheDocument()
    expect(screen.getByText('Weight')).toBeInTheDocument()
  })

  it('renders unit selects for size and weight units', () => {
    const setValue = jest.fn()
    render(<VariantDimensionsSection values={createDefaultValues()} setValue={setValue} />)
    expect(screen.getByText('Size unit')).toBeInTheDocument()
    expect(screen.getByText('Weight unit')).toBeInTheDocument()
  })

  it('calls setValue with updated metadata when dimension input changes', () => {
    const setValue = jest.fn()
    const metadata = { dimensions: { width: 10, height: 20 } }
    render(<VariantDimensionsSection values={createDefaultValues({ metadata })} setValue={setValue} />)
    const widthInput = screen.getAllByPlaceholderText('0')[0]
    fireEvent.change(widthInput, { target: { value: '15' } })
    expect(setValue).toHaveBeenCalledWith(
      'metadata',
      expect.objectContaining({
        dimensions: expect.objectContaining({ width: 15 }),
      }),
    )
  })
})

describe('VariantPricesSection', () => {
  it('renders price inputs for each price kind', () => {
    const setValue = jest.fn()
    render(
      <VariantPricesSection
        values={createDefaultValues()}
        setValue={setValue}
        priceKinds={createPriceKinds()}
        taxRates={createTaxRates()}
      />,
    )
    expect(screen.getByText('Retail')).toBeInTheDocument()
    expect(screen.getByText('Wholesale')).toBeInTheDocument()
  })

  it('renders empty state when no price kinds are configured', () => {
    const setValue = jest.fn()
    render(
      <VariantPricesSection values={createDefaultValues()} setValue={setValue} priceKinds={[]} taxRates={createTaxRates()} />,
    )
    expect(screen.getByText('No price kinds configured yet.')).toBeInTheDocument()
  })

  it('renders tax rate select with options', () => {
    const setValue = jest.fn()
    render(
      <VariantPricesSection
        values={createDefaultValues()}
        setValue={setValue}
        priceKinds={createPriceKinds()}
        taxRates={createTaxRates()}
      />,
    )
    const selects = document.querySelectorAll('select')
    expect(selects.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('No tax override')).toBeInTheDocument()
  })

  it('calls setValue when price amount is changed', () => {
    const setValue = jest.fn()
    render(
      <VariantPricesSection
        values={createDefaultValues()}
        setValue={setValue}
        priceKinds={createPriceKinds()}
        taxRates={createTaxRates()}
      />,
    )
    const priceInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(priceInputs[0], { target: { value: '9.99' } })
    expect(setValue).toHaveBeenCalledWith(
      'prices',
      expect.objectContaining({
        'pk-1': expect.objectContaining({ amount: '9.99', priceKindId: 'pk-1' }),
      }),
    )
  })
})

describe('VariantMediaSection', () => {
  it('renders the media label and media manager', () => {
    const setValue = jest.fn()
    render(<VariantMediaSection values={createDefaultValues()} setValue={setValue} />)
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByTestId('product-media-manager')).toBeInTheDocument()
  })
})

describe('VariantBuilder (full)', () => {
  it('renders all section components together', () => {
    const setValue = jest.fn()
    render(
      <VariantBuilder
        values={createDefaultValues()}
        setValue={setValue}
        errors={{}}
        optionDefinitions={createOptionDefinitions()}
        priceKinds={createPriceKinds()}
        taxRates={createTaxRates()}
      />,
    )
    expect(screen.getByPlaceholderText('e.g., Blue / Small')).toBeInTheDocument()
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Width')).toBeInTheDocument()
    expect(screen.getByText('Retail')).toBeInTheDocument()
    expect(screen.getByTestId('product-media-manager')).toBeInTheDocument()
    expect(screen.getByTestId('metadata-editor')).toBeInTheDocument()
  })
})
