"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { cn } from '@open-mercato/shared/lib/utils'
import { Plus, Trash2, FileText, AlignLeft, Upload, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from '@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type UiMarkdownEditorProps = {
  value?: string
  height?: number
  onChange?: (value?: string) => void
  previewOptions?: { remarkPlugins?: unknown[] }
}

const MarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading editor…</div>,
}) as unknown as React.ComponentType<UiMarkdownEditorProps>

type PriceKindSummary = {
  id: string
  code: string
  title: string
  currencyCode: string | null
  displayMode: 'including-tax' | 'excluding-tax'
}

type ProductOptionInput = {
  id: string
  title: string
  values: Array<{ id: string; label: string }>
}

type VariantPriceValue = {
  amount: string
}

type VariantDraft = {
  id: string
  title: string
  sku: string
  isDefault: boolean
  manageInventory: boolean
  allowBackorder: boolean
  hasInventoryKit: boolean
  optionValues: Record<string, string>
  prices: Record<string, VariantPriceValue>
}

type ProductFormValues = {
  title: string
  subtitle: string
  handle: string
  description: string
  useMarkdown: boolean
  primaryCurrencyCode: string
  attachments: File[]
  hasVariants: boolean
  options: ProductOptionInput[]
  variants: VariantDraft[]
}

const productFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  subtitle: z.string().optional(),
  handle: z
    .string()
    .trim()
    .regex(/^[a-z0-9\-_]*$/, 'Handle must include lowercase letters, digits, hyphen, or underscore')
    .max(150)
    .optional(),
  description: z.string().optional(),
  useMarkdown: z.boolean().optional(),
  primaryCurrencyCode: z
    .string()
    .trim()
    .length(3, 'Currency must be a three-letter code')
    .optional(),
  hasVariants: z.boolean().optional(),
  attachments: z.any().optional(),
  options: z.any().optional(),
  variants: z.any().optional(),
})

const DEFAULT_VARIANT: VariantDraft = {
  id: createLocalId(),
  title: 'Default variant',
  sku: '',
  isDefault: true,
  manageInventory: false,
  allowBackorder: false,
  hasInventoryKit: false,
  optionValues: {},
  prices: {},
}

const INITIAL_VALUES: ProductFormValues = {
  title: '',
  subtitle: '',
  handle: '',
  description: '',
  useMarkdown: false,
  primaryCurrencyCode: '',
  attachments: [],
  hasVariants: false,
  options: [],
  variants: [DEFAULT_VARIANT],
}

const steps = ['general', 'organize', 'variants'] as const

export default function CreateCatalogProductPage() {
  const t = useT()
  const router = useRouter()
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([])
  const {
    data: currencyDictionary,
    refetch: refetchCurrencyDictionary,
  } = useCurrencyDictionary()

  React.useEffect(() => {
    const loadPriceKinds = async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: PriceKindSummary[] }>(
          '/api/catalog/price-kinds?pageSize=200',
          undefined,
          { errorMessage: t('catalog.priceKinds.errors.load', 'Failed to load price kinds.') },
        )
        setPriceKinds(Array.isArray(payload.items) ? payload.items : [])
      } catch (err) {
        console.error('catalog.price-kinds.fetch failed', err)
        setPriceKinds([])
      }
    }
    loadPriceKinds().catch(() => {})
  }, [t])

  const fetchCurrencyOptions = React.useCallback(async () => {
    const entries = currencyDictionary?.entries ?? (await refetchCurrencyDictionary()).entries
    return entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [currencyDictionary, refetchCurrencyDictionary])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'builder',
      column: 1,
      component: ({ values, setValue, errors }: CrudFormGroupComponentProps) => (
        <ProductBuilder
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          priceKinds={priceKinds}
        />
      ),
    },
    {
      id: 'product-meta',
      column: 2,
      title: t('catalog.products.create.meta.title', 'Product meta'),
      description: t('catalog.products.create.meta.description', 'Manage subtitle, handle, and currency for storefronts.'),
      component: ({ values, setValue, errors }: CrudFormGroupComponentProps) => (
        <ProductMetaSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          currencyOptionsLoader={fetchCurrencyOptions}
        />
      ),
    },
  ], [priceKinds, fetchCurrencyOptions, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ProductFormValues>
          title={t('catalog.products.create.title', 'Create product')}
          backHref="/backend/catalog/products"
          fields={[]}
          groups={groups}
          initialValues={INITIAL_VALUES}
          schema={productFormSchema}
          submitLabel={t('catalog.products.create.submit', 'Create')}
          cancelHref="/backend/catalog/products"
          onSubmit={async (formValues) => {
            const title = formValues.title?.trim()
            if (!title) {
              throw createCrudFormError(t('catalog.products.create.errors.title', 'Provide a product title.'), {
                title: t('catalog.products.create.errors.title', 'Provide a product title.'),
              })
            }
            const handle = formValues.handle?.trim() || undefined
            const description = formValues.description?.trim() || undefined
            const primaryCurrency = formValues.primaryCurrencyCode?.trim().toUpperCase() || undefined

            const productPayload: Record<string, unknown> = {
              title,
              subtitle: formValues.subtitle?.trim() || undefined,
              description,
              handle,
              isConfigurable: Boolean(formValues.hasVariants),
              primaryCurrencyCode: primaryCurrency,
              metadata: formValues.options.length ? { optionSchema: formValues.options } : undefined,
            }

            const { result: created } = await createCrud<{ id?: string }>('catalog/products', productPayload)
            const productId = created?.id
            if (!productId) {
              throw createCrudFormError(t('catalog.products.create.errors.id', 'Product id missing after create.'))
            }

            const variantDrafts = Array.isArray(formValues.variants) && formValues.variants.length
              ? formValues.variants
              : [DEFAULT_VARIANT]
            const variantIdMap: Record<string, string> = {}
            for (const variant of variantDrafts) {
              const variantPayload: Record<string, unknown> = {
                productId,
                name: variant.title?.trim() || Object.values(variant.optionValues).join(' / ') || 'Variant',
                sku: variant.sku?.trim() || undefined,
                isDefault: Boolean(variant.isDefault),
                isActive: true,
                metadata: Object.keys(variant.optionValues).length ? { optionValues: variant.optionValues } : undefined,
              }
              const { result: variantResult } = await createCrud<{ id?: string; variantId?: string }>(
                'catalog/variants',
                variantPayload,
              )
              const variantId = variantResult?.variantId ?? variantResult?.id
              if (!variantId) {
                throw createCrudFormError(t('catalog.products.create.errors.variant', 'Failed to create variant.'))
              }
              variantIdMap[variant.id] = variantId
            }

            for (const variant of variantDrafts) {
              const variantId = variantIdMap[variant.id]
              if (!variantId) continue
              for (const priceKind of priceKinds) {
                const value = variant.prices?.[priceKind.id]?.amount?.trim()
                if (!value) continue
                const numeric = Number(value)
                if (Number.isNaN(numeric)) continue
                const currencyCode = priceKind.currencyCode ?? primaryCurrency
                if (!currencyCode) {
                  throw createCrudFormError(
                    t('catalog.products.create.errors.currency', 'Provide a currency for all price kinds.'),
                    {},
                  )
                }
                const pricePayload: Record<string, unknown> = {
                  productId,
                  variantId,
                  currencyCode,
                  priceKindId: priceKind.id,
                }
                if (priceKind.displayMode === 'including-tax') {
                  pricePayload.unitPriceGross = numeric
                } else {
                  pricePayload.unitPriceNet = numeric
                }
                await createCrud('catalog/prices', pricePayload)
              }
            }

            const attachments: File[] = Array.isArray(formValues.attachments) ? formValues.attachments : []
            for (const file of attachments) {
              const fd = new FormData()
              fd.set('entityId', E.catalog.catalog_product)
              fd.set('recordId', productId)
              fd.set('file', file)
              try {
                await fetch('/api/attachments', { method: 'POST', body: fd })
              } catch (err) {
                console.error('attachments.upload failed', err)
              }
            }

            flash(t('catalog.products.create.success', 'Product created.'), 'success')
            router.push('/backend/catalog/products')
          }}
        />
      </PageBody>
    </Page>
  )
}

type ProductBuilderProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  priceKinds: PriceKindSummary[]
}

type ProductMetaSectionProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  currencyOptionsLoader: () => Promise<Array<{ value: string; label: string; color: string | null; icon: string | null }>>
}

function ProductBuilder({ values, setValue, errors, priceKinds }: ProductBuilderProps) {
  const t = useT()
  const [currentStep, setCurrentStep] = React.useState(0)

  React.useEffect(() => {
    if (currentStep >= steps.length) setCurrentStep(0)
  }, [currentStep])

  const ensureVariants = React.useCallback(() => {
    const optionDefinitions = Array.isArray(values.options) ? values.options : []
    if (!values.hasVariants || !optionDefinitions.length) {
      if (!values.variants || !values.variants.length) {
        setValue('variants', [DEFAULT_VARIANT])
      }
      return
    }
    const combos = buildVariantCombinations(optionDefinitions)
    const existing = Array.isArray(values.variants) ? values.variants : []
    let hasDefault = existing.some((variant) => variant.isDefault)
    const nextVariants: VariantDraft[] = combos.map((combo) => {
      const existingMatch = existing.find((entry) =>
        Object.keys(combo).every((key) => entry.optionValues?.[key] === combo[key]),
      )
      if (existingMatch) {
        if (existingMatch.isDefault) hasDefault = true
        return { ...existingMatch, optionValues: combo }
      }
      return {
        id: createLocalId(),
        title: Object.values(combo).join(' / '),
        sku: '',
        isDefault: false,
        manageInventory: false,
        allowBackorder: false,
        hasInventoryKit: false,
        optionValues: combo,
        prices: {},
      }
    })
    if (nextVariants.length) {
      if (!hasDefault) {
        nextVariants[0].isDefault = true
      }
      setValue('variants', nextVariants)
    }
  }, [values.options, values.variants, values.hasVariants, setValue])

  React.useEffect(() => {
    ensureVariants()
  }, [ensureVariants])

  const handleAttachmentChange = React.useCallback((files: FileList | null) => {
    if (!files) return
    const current = Array.isArray(values.attachments) ? values.attachments : []
    setValue('attachments', [...current, ...Array.from(files)])
  }, [values.attachments, setValue])

  const removeAttachment = React.useCallback((index: number) => {
    const current = Array.isArray(values.attachments) ? values.attachments : []
    const next = current.filter((_, idx) => idx !== index)
    setValue('attachments', next)
  }, [values.attachments, setValue])

  const setVariantField = React.useCallback(
    (variantId: string, field: keyof VariantDraft, value: unknown) => {
      const next = (Array.isArray(values.variants) ? values.variants : []).map((variant) => {
        if (variant.id !== variantId) return variant
        return { ...variant, [field]: value }
      })
      setValue('variants', next)
    },
    [values.variants, setValue],
  )

  const setVariantPrice = React.useCallback(
    (variantId: string, priceKindId: string, amount: string) => {
      const next = (Array.isArray(values.variants) ? values.variants : []).map((variant) => {
        if (variant.id !== variantId) return variant
        return {
          ...variant,
          prices: {
            ...(variant.prices ?? {}),
            [priceKindId]: { amount },
          },
        }
      })
      setValue('variants', next)
    },
    [values.variants, setValue],
  )

  const markDefaultVariant = React.useCallback((variantId: string) => {
    const next = (Array.isArray(values.variants) ? values.variants : []).map((variant) => ({
      ...variant,
      isDefault: variant.id === variantId,
    }))
    setValue('variants', next)
  }, [values.variants, setValue])

  const handleOptionTitleChange = React.useCallback((optionId: string, title: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).map((option) => {
      if (option.id !== optionId) return option
      return { ...option, title }
    })
    setValue('options', next)
  }, [values.options, setValue])

  const addOptionValue = React.useCallback((optionId: string, label: string) => {
    if (!label.trim()) return
    const next = (Array.isArray(values.options) ? values.options : []).map((option) => {
      if (option.id !== optionId) return option
      return {
        ...option,
        values: [...option.values, { id: createLocalId(), label: label.trim() }],
      }
    })
    setValue('options', next)
  }, [values.options, setValue])

  const removeOptionValue = React.useCallback((optionId: string, valueId: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).map((option) => {
      if (option.id !== optionId) return option
      return {
        ...option,
        values: option.values.filter((value) => value.id !== valueId),
      }
    })
    setValue('options', next)
  }, [values.options, setValue])

  const addOption = React.useCallback(() => {
    const next = [
      ...(Array.isArray(values.options) ? values.options : []),
      { id: createLocalId(), title: '', values: [] },
    ]
    setValue('options', next)
  }, [values.options, setValue])

  const removeOption = React.useCallback((optionId: string) => {
    const next = (Array.isArray(values.options) ? values.options : []).filter((option) => option.id !== optionId)
    setValue('options', next)
  }, [values.options, setValue])

  const attachments = Array.isArray(values.attachments) ? values.attachments : []

  return (
    <div className="space-y-6">
      <nav className="flex gap-6 border-b pb-2 text-sm font-medium">
        {steps.map((step, index) => (
          <button
            key={step}
            type="button"
            className={cn(
              'relative pb-2',
              currentStep === index ? 'text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => setCurrentStep(index)}
          >
            {step === 'general' && t('catalog.products.create.steps.general', 'General data')}
            {step === 'organize' && t('catalog.products.create.steps.organize', 'Organize')}
            {step === 'variants' && t('catalog.products.create.steps.variants', 'Variants')}
            {currentStep === index ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground rounded-full" />
            ) : null}
          </button>
        ))}
      </nav>

      {currentStep === 0 ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              {t('catalog.products.form.title', 'Title')}
              <span className="text-red-600">*</span>
            </Label>
            <Input
              value={values.title}
              onChange={(event) => setValue('title', event.target.value)}
              placeholder={t('catalog.products.create.placeholders.title', 'e.g., Summer sneaker')}
            />
            {errors.title ? <p className="text-xs text-red-600">{errors.title}</p> : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('catalog.products.form.description', 'Description')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setValue('useMarkdown', !values.useMarkdown)}
                className="gap-2 text-xs"
              >
                {values.useMarkdown ? <AlignLeft className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                {values.useMarkdown
                  ? t('catalog.products.create.actions.usePlain', 'Use plain text')
                  : t('catalog.products.create.actions.useMarkdown', 'Use markdown')}
              </Button>
            </div>
            {values.useMarkdown ? (
              <div data-color-mode="light" className="overflow-hidden rounded-md border">
                <MarkdownEditor
                  value={values.description}
                  height={260}
                  onChange={(val) => setValue('description', val ?? '')}
                  previewOptions={{ remarkPlugins: [] }}
                />
              </div>
            ) : (
              <textarea
                className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={values.description}
                onChange={(event) => setValue('description', event.target.value)}
                placeholder={t('catalog.products.create.placeholders.description', 'Describe the product...')}
              />
            )}
          </div>

          <div className="space-y-3">
            <Label>{t('catalog.products.create.attachments.title', 'Media')}</Label>
            <div className="rounded-lg border border-dashed p-6 text-center">
              <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {t('catalog.products.create.attachments.help', 'Drag and drop images here or click to upload.')}
              </p>
              <input
                type="file"
                accept="image/*"
                multiple
                className="mt-4 text-sm"
                onChange={(event) => handleAttachmentChange(event.target.files)}
              />
            </div>
            {attachments.length ? (
              <ul className="space-y-2 text-sm">
                {attachments.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                    </div>
                    <Button variant="ghost" size="icon" type="button" onClick={() => removeAttachment(index)}>
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">{t('catalog.products.create.attachments.remove', 'Remove')}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {currentStep === 1 ? (
        <div className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
          {t('catalog.products.create.organize.placeholder', 'Work in progress on this tab.')}
        </div>
      ) : null}

      {currentStep === 2 ? (
        <div className="space-y-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={values.hasVariants}
              onChange={(event) => setValue('hasVariants', event.target.checked)}
            />
            {t('catalog.products.create.variantsBuilder.toggle', 'Yes, this is a product with variants')}
          </label>

          {values.hasVariants ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('catalog.products.create.optionsBuilder.title', 'Product options')}</h3>
                <Button type="button" variant="outline" size="sm" onClick={addOption}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('catalog.products.create.optionsBuilder.add', 'Add option')}
                </Button>
              </div>
              {(Array.isArray(values.options) ? values.options : []).map((option) => (
                <div key={option.id} className="rounded-md border p-4">
                  <div className="flex items-center gap-2">
                    <Input
                      value={option.title}
                      onChange={(event) => handleOptionTitleChange(option.id, event.target.value)}
                      placeholder={t('catalog.products.create.optionsBuilder.placeholder', 'e.g., Color')}
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon" type="button" onClick={() => removeOption(option.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground">
                      {t('catalog.products.create.optionsBuilder.values', 'Values')}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {option.values.map((value) => (
                        <span key={value.id} className="inline-flex items-center rounded-full border px-3 py-1 text-xs">
                          {value.label}
                          <button type="button" className="ml-2 text-muted-foreground hover:text-foreground" onClick={() => removeOptionValue(option.id, value.id)}>×</button>
                        </span>
                      ))}
                      <AddOptionValue onAdd={(label) => addOptionValue(option.id, label)} />
                    </div>
                  </div>
                </div>
              ))}
              {!values.options?.length ? (
                <p className="text-sm text-muted-foreground">
                  {t('catalog.products.create.optionsBuilder.empty', 'No options yet. Add your first option to generate variants.')}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">{t('catalog.products.create.variantsBuilder.defaultOption', 'Default option')}</th>
                  <th className="px-3 py-2 text-left">{t('catalog.products.form.variants', 'Variant title')}</th>
                  <th className="px-3 py-2 text-left">{t('catalog.products.create.variantsBuilder.sku', 'SKU')}</th>
                  <th className="px-3 py-2 text-center">{t('catalog.products.create.variantsBuilder.manageInventory', 'Managed inventory')}</th>
                  <th className="px-3 py-2 text-center">{t('catalog.products.create.variantsBuilder.allowBackorder', 'Allow backorder')}</th>
                  <th className="px-3 py-2 text-center">{t('catalog.products.create.variantsBuilder.inventoryKit', 'Has inventory kit')}</th>
                  {priceKinds.map((kind) => (
                    <th key={kind.id} className="px-3 py-2 text-left">
                      <div className="flex items-center gap-1">
                        <span>{t('catalog.products.create.variantsBuilder.priceColumn', 'Price {{title}}').replace('{{title}}', kind.title)}</span>
                        <small title={kind.displayMode === 'including-tax' ? t('catalog.priceKinds.form.displayMode.include', 'Including tax') : t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax')} className="text-xs text-muted-foreground">
                          {kind.displayMode === 'including-tax' ? 'Ⓣ' : 'Ⓝ'}
                        </small>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(values.variants) ? values.variants : [DEFAULT_VARIANT]).map((variant) => (
                  <tr key={variant.id} className="border-t">
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          name="defaultVariant"
                          checked={variant.isDefault}
                          onChange={() => markDefaultVariant(variant.id)}
                        />
                        {variant.isDefault
                          ? t('catalog.products.create.variantsBuilder.defaultLabel', 'Default option value')
                          : t('catalog.products.create.variantsBuilder.makeDefault', 'Set as default')}
                      </label>
                      {values.hasVariants && variant.optionValues
                        ? (
                          <p className="text-xs text-muted-foreground">{Object.values(variant.optionValues).join(' / ')}</p>
                        )
                        : null}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={variant.title}
                        onChange={(event) => setVariantField(variant.id, 'title', event.target.value)}
                        placeholder={t('catalog.products.create.variantsBuilder.titlePlaceholder', 'Variant title')}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={variant.sku}
                        onChange={(event) => setVariantField(variant.id, 'sku', event.target.value)}
                        placeholder={t('catalog.products.create.variantsBuilder.skuPlaceholder', 'e.g., SKU-001')}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border"
                        checked={variant.manageInventory}
                        onChange={(event) => setVariantField(variant.id, 'manageInventory', event.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border"
                        checked={variant.allowBackorder}
                        onChange={(event) => setVariantField(variant.id, 'allowBackorder', event.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border"
                        checked={variant.hasInventoryKit}
                        onChange={(event) => setVariantField(variant.id, 'hasInventoryKit', event.target.checked)}
                      />
                    </td>
                    {priceKinds.map((kind) => (
                      <td key={kind.id} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {kind.currencyCode ?? values.primaryCurrencyCode ?? '—'}
                          </span>
                          <input
                            type="number"
                            className="w-full rounded-md border px-2 py-1"
                            value={variant.prices?.[kind.id]?.amount ?? ''}
                            onChange={(event) => setVariantPrice(variant.id, kind.id, event.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!priceKinds.length ? (
              <div className="flex items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                {t('catalog.products.create.variantsBuilder.noPriceKinds', 'Configure price kinds in Catalog settings to add price columns.')}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('catalog.products.create.steps.previous', 'Previous')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
          className="gap-2"
        >
          {currentStep === steps.length - 1 ? t('catalog.products.create.steps.review', 'Review') : t('catalog.products.create.steps.continue', 'Continue')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ProductMetaSection({ values, setValue, errors, currencyOptionsLoader }: ProductMetaSectionProps) {
  const t = useT()
  const currencyLabels = React.useMemo(() => ({
    placeholder: t('catalog.products.create.currency.placeholder', 'Select currency…'),
    addLabel: t('catalog.products.create.currency.add', 'Add currency'),
    addPrompt: t('catalog.products.create.currency.addPrompt', 'Provide a currency code.'),
    dialogTitle: t('catalog.products.create.currency.dialogTitle', 'Add currency'),
    valueLabel: t('catalog.products.create.currency.valueLabel', 'Currency code'),
    valuePlaceholder: t('catalog.products.create.currency.valuePlaceholder', 'e.g. USD'),
    labelLabel: t('catalog.products.create.currency.labelLabel', 'Display label'),
    labelPlaceholder: t('catalog.products.create.currency.labelPlaceholder', 'e.g. US Dollar'),
    emptyError: t('catalog.products.create.currency.required', 'Currency code is required.'),
    cancelLabel: t('catalog.products.create.currency.cancel', 'Cancel'),
    saveLabel: t('catalog.products.create.currency.save', 'Save'),
    saveShortcutHint: t('catalog.products.create.currency.saveShortcut', 'Press Enter to save'),
    successCreateLabel: t('catalog.products.create.currency.success', 'Currency added.'),
    errorLoad: t('catalog.products.create.currency.loadError', 'Unable to load currencies.'),
    errorSave: t('catalog.products.create.currency.error', 'Unable to add currency.'),
    loadingLabel: t('catalog.products.create.currency.loading', 'Loading currencies…'),
    manageTitle: t('catalog.products.create.currency.manage', 'Manage currencies'),
  }), [t])

  const handleValue = typeof values.handle === 'string' ? values.handle : ''
  const titleSource = typeof values.title === 'string' ? values.title : ''

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('catalog.products.form.subtitle', 'Subtitle')}</Label>
        <Input
          value={typeof values.subtitle === 'string' ? values.subtitle : ''}
          onChange={(event) => setValue('subtitle', event.target.value)}
          placeholder={t('catalog.products.create.placeholders.subtitle', 'Optional subtitle')}
        />
        {errors.subtitle ? <p className="text-xs text-red-600">{errors.subtitle}</p> : null}
      </div>

      <div className="space-y-2">
        <Label>{t('catalog.products.form.handle', 'Handle')}</Label>
        <div className="flex gap-2">
          <Input
            value={handleValue}
            onChange={(event) => setValue('handle', event.target.value)}
            placeholder={t('catalog.products.create.placeholders.handle', 'e.g., summer-sneaker')}
            className="font-mono lowercase"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const slug = slugify(titleSource)
              setValue('handle', slug)
            }}
          >
            {t('catalog.products.create.actions.generateHandle', 'Generate')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.handleHelp', 'Handle is used for URLs and must be unique.')}
        </p>
        {errors.handle ? <p className="text-xs text-red-600">{errors.handle}</p> : null}
      </div>

      <div className="space-y-2">
        <Label>{t('catalog.products.create.fields.currency', 'Primary currency')}</Label>
        <DictionaryEntrySelect
          value={values.primaryCurrencyCode || undefined}
          onChange={(value) => setValue('primaryCurrencyCode', value ?? '')}
          fetchOptions={currencyOptionsLoader}
          labels={currencyLabels}
          allowInlineCreate={false}
        />
        {errors.primaryCurrencyCode ? <p className="text-xs text-red-600">{errors.primaryCurrencyCode}</p> : null}
      </div>
    </div>
  )
}

function AddOptionValue({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = React.useState('')
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onAdd(value)
        setValue('')
      }}
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="e.g., Blue"
      />
      <Button type="submit" variant="outline" size="icon">
        <Plus className="h-4 w-4" />
      </Button>
    </form>
  )
}

function buildVariantCombinations(options: ProductOptionInput[]): Record<string, string>[] {
  if (!options.length) return []
  const [first, ...rest] = options
  const initial = first.values.map((value) => ({ [first.id]: value.label }))
  return rest.reduce<Record<string, string>[]>((acc, option) => {
    const combos: Record<string, string>[] = []
    acc.forEach((partial) => {
      option.values.forEach((value) => {
        combos.push({ ...partial, [option.id]: value.label })
      })
    })
    return combos
  }, initial)
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatSize(size: number): string {
  if (!Number.isFinite(size)) return `${size}`
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function createLocalId(): string {
  return Math.random().toString(36).slice(2, 10)
}
