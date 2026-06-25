/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { ProductComplianceSection } from '../ProductComplianceSection'
import type { ProductFormValues } from '../productForm'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => (fallback ?? key) as string
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

jest.mock('@open-mercato/ui/primitives/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: ({ ...props }: any) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: ({ showCount, wrapperClassName, ...props }: any) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))

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
    countryOfOriginCode: '',
    pkwiuCode: '',
    cnCode: '',
    hsCode: '',
    taxClassificationCode: '',
    gtuCodes: [],
    ageMin: '',
    isExciseGood: false,
    exciseCategory: null,
    requiresPrescription: false,
    hazmatClass: '',
    unNumber: '',
    hazmatPackingGroup: null,
    containsLithiumBattery: false,
    launchAt: '',
    endOfLifeAt: '',
    availableFrom: '',
    availableUntil: '',
    minOrderQty: '',
    maxOrderQty: '',
    orderQtyIncrement: '',
    requiresShipping: true,
    isQuoteOnly: false,
    seoTitle: '',
    seoDescription: '',
    canonicalUrl: '',
    ...overrides,
  }
}

describe('ProductComplianceSection a11y error wiring', () => {
  it('marks a text input invalid and links it to the error message when an error is present', () => {
    const { container } = render(
      <ProductComplianceSection
        values={createDefaultValues()}
        setValue={jest.fn()}
        errors={{ unNumber: 'Invalid UN number' }}
      />,
    )

    const input = container.querySelector('#catalog-product-compliance-un-number')
    const error = container.querySelector('#catalog-product-compliance-un-number-error')

    expect(input).not.toBeNull()
    expect(error).not.toBeNull()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'catalog-product-compliance-un-number-error')
    expect(error).toHaveTextContent('Invalid UN number')
  })

  it('does not set aria-invalid or aria-describedby when a field has no error', () => {
    const { container } = render(
      <ProductComplianceSection
        values={createDefaultValues()}
        setValue={jest.fn()}
        errors={{}}
      />,
    )

    const input = container.querySelector('#catalog-product-compliance-un-number')

    expect(input).not.toBeNull()
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(container.querySelector('#catalog-product-compliance-un-number-error')).toBeNull()
  })

  it('wires the select trigger error state', () => {
    const { container } = render(
      <ProductComplianceSection
        values={createDefaultValues()}
        setValue={jest.fn()}
        errors={{ hazmatPackingGroup: 'Required' }}
      />,
    )

    const trigger = container.querySelector('#catalog-product-compliance-packing-group')
    const error = container.querySelector('#catalog-product-compliance-packing-group-error')

    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', 'catalog-product-compliance-packing-group-error')
    expect(error).toHaveTextContent('Required')
  })

  it('wires the textarea error state', () => {
    const { container } = render(
      <ProductComplianceSection
        values={createDefaultValues()}
        setValue={jest.fn()}
        errors={{ seoDescription: 'Too long' }}
      />,
    )

    const textarea = container.querySelector('#catalog-product-compliance-seo-description')
    const error = container.querySelector('#catalog-product-compliance-seo-description-error')

    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAttribute('aria-describedby', 'catalog-product-compliance-seo-description-error')
    expect(error).toHaveTextContent('Too long')
  })

  it('exposes the GTU checkbox group as a labelled group and wires its error', () => {
    const { container } = render(
      <ProductComplianceSection
        values={createDefaultValues()}
        setValue={jest.fn()}
        errors={{ gtuCodes: 'Pick at least one' }}
      />,
    )

    const group = container.querySelector('[role="group"]')
    const error = container.querySelector('#catalog-product-compliance-gtu-error')

    expect(group).not.toBeNull()
    expect(group).toHaveAttribute('aria-labelledby', 'catalog-product-compliance-gtu-label')
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAttribute('aria-describedby', 'catalog-product-compliance-gtu-error')
    expect(error).toHaveTextContent('Pick at least one')
  })
})
