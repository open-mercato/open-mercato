/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { StoreCreateDialog, buildStoreCreatePayload, storeCreateFormSchema, type StoreCreateFormValues } from '../StoreCreateDialog'

const createCrudMock = jest.fn()
const flashMock = jest.fn()

let crudFormProps: {
  fields: Array<{ id: string; type: string; required?: boolean }>
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: Array<{ message: string; path: unknown[] }> } } }
  initialValues: StoreCreateFormValues
  embedded?: boolean
  onSubmit: (values: StoreCreateFormValues) => Promise<void>
} | null = null

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'pl',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => createCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: NonNullable<typeof crudFormProps>) => {
    crudFormProps = props
    return null
  },
}))

const validValues: StoreCreateFormValues = {
  name: 'Second brand',
  code: 'second-brand',
  slug: 'second-brand',
  defaultLocale: 'pl',
  supportedLocales: ['pl', 'en'],
  defaultCurrencyCode: 'pln',
}

describe('StoreCreateDialog', () => {
  beforeEach(() => {
    createCrudMock.mockReset()
    flashMock.mockReset()
    crudFormProps = null
  })

  it('renders an embedded CrudForm with the required store fields and locale defaults from the UI locale', () => {
    render(<StoreCreateDialog open onOpenChange={jest.fn()} onCreated={jest.fn()} />)
    expect(crudFormProps?.embedded).toBe(true)
    expect(crudFormProps?.fields.map((field) => field.id)).toEqual([
      'name',
      'code',
      'slug',
      'defaultLocale',
      'defaultCurrencyCode',
      'supportedLocales',
    ])
    expect(crudFormProps?.fields.every((field) => field.required)).toBe(true)
    expect(crudFormProps?.initialValues).toMatchObject({ defaultLocale: 'pl', supportedLocales: ['pl'] })
  })

  it('creates the store through the CRUD API, normalizes the payload and reports success', async () => {
    createCrudMock.mockResolvedValue({ ok: true, result: { id: 'store-9' } })
    const onOpenChange = jest.fn()
    const onCreated = jest.fn()
    render(<StoreCreateDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)
    await crudFormProps?.onSubmit({ ...validValues, name: '  Second brand ' })
    expect(createCrudMock).toHaveBeenCalledWith(
      'ecommerce/stores',
      {
        name: 'Second brand',
        code: 'second-brand',
        slug: 'second-brand',
        defaultLocale: 'pl',
        supportedLocales: ['pl', 'en'],
        defaultCurrencyCode: 'PLN',
      },
      expect.objectContaining({ errorMessage: 'Failed to create the store.' }),
    )
    expect(flashMock).toHaveBeenCalledWith('Store created', 'success')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledWith('store-9')
  })

  it('rethrows a duplicate code or slug 409 so CrudForm renders it on the field', async () => {
    const conflict = Object.assign(new Error('A store with this code already exists.'), {
      status: 409,
      fieldErrors: { code: 'A store with this code already exists.' },
    })
    createCrudMock.mockRejectedValue(conflict)
    const onOpenChange = jest.fn()
    render(<StoreCreateDialog open onOpenChange={onOpenChange} onCreated={jest.fn()} />)
    await expect(crudFormProps?.onSubmit(validValues)).rejects.toBe(conflict)
    expect(flashMock).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('storeCreateFormSchema', () => {
  it('accepts a complete store and uppercases the currency', () => {
    const parsed = storeCreateFormSchema.safeParse(validValues)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.defaultCurrencyCode).toBe('PLN')
  })

  it('reports invalid code, slug, locale and currency with translation keys', () => {
    const parsed = storeCreateFormSchema.safeParse({
      ...validValues,
      code: 'Bad Code',
      slug: 'bad--slug',
      defaultLocale: 'polish',
      defaultCurrencyCode: 'EURO',
    })
    expect(parsed.success).toBe(false)
    const messages = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'ecommerce.validation.codeInvalid',
        'ecommerce.validation.slugInvalid',
        'ecommerce.validation.localeInvalid',
        'ecommerce.validation.currencyCodeInvalid',
      ]),
    )
  })

  it('requires the default locale to be one of the supported locales', () => {
    const parsed = storeCreateFormSchema.safeParse({ ...validValues, supportedLocales: ['en'] })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ message: 'ecommerce.validation.defaultLocaleNotSupported', path: ['defaultLocale'] }),
      )
    }
  })

  it('builds a trimmed payload without status or settings so the server applies its defaults', () => {
    expect(Object.keys(buildStoreCreatePayload(validValues)).sort()).toEqual([
      'code',
      'defaultCurrencyCode',
      'defaultLocale',
      'name',
      'slug',
      'supportedLocales',
    ])
  })
})
