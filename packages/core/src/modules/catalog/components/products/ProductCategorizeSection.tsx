import * as React from 'react'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { ProductFormValues } from './productForm'

export type ProductCategorizePickerOption = {
  value: string
  label: string
  description?: string | null
}

const formatCategoryLabel = (name: string | null | undefined, fallback: string, parentName?: string | null) => {
  const base = typeof name === 'string' && name.trim().length ? name.trim() : fallback
  const parent = typeof parentName === 'string' && parentName.trim().length ? parentName.trim() : null
  return parent ? `${base} / ${parent}` : base
}

type ProductCategorizeSectionProps = {
  values: ProductFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  initialCategoryOptions?: ProductCategorizePickerOption[]
  initialChannelOptions?: ProductCategorizePickerOption[]
  initialTagOptions?: ProductCategorizePickerOption[]
}

export function ProductCategorizeSection({
  values,
  setValue,
  errors,
  initialCategoryOptions,
  initialChannelOptions,
  initialTagOptions,
}: ProductCategorizeSectionProps) {
  const t = useT()
  const [categoryOptionsMap, setCategoryOptionsMap] = React.useState<Record<string, ProductCategorizePickerOption>>({})
  const [channelOptionsMap, setChannelOptionsMap] = React.useState<Record<string, ProductCategorizePickerOption>>({})
  const [tagOptionsMap, setTagOptionsMap] = React.useState<Record<string, ProductCategorizePickerOption>>({})

  const registerPickerOptions = React.useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, ProductCategorizePickerOption>>>,
      options: ProductCategorizePickerOption[],
    ) => {
      setter((prev) => {
        const next = { ...prev }
        options.forEach((option) => {
          if (option.value) next[option.value] = option
        })
        return next
      })
    },
    [],
  )

  const categorySuggestions = React.useMemo(() => Object.values(categoryOptionsMap), [categoryOptionsMap])
  const channelSuggestions = React.useMemo(() => Object.values(channelOptionsMap), [channelOptionsMap])
  const tagSuggestions = React.useMemo(() => Object.values(tagOptionsMap), [tagOptionsMap])

  React.useEffect(() => {
    if (initialCategoryOptions?.length) {
      registerPickerOptions(setCategoryOptionsMap, initialCategoryOptions)
    }
  }, [initialCategoryOptions, registerPickerOptions])

  React.useEffect(() => {
    if (initialChannelOptions?.length) {
      registerPickerOptions(setChannelOptionsMap, initialChannelOptions)
    }
  }, [initialChannelOptions, registerPickerOptions])

  React.useEffect(() => {
    if (initialTagOptions?.length) {
      registerPickerOptions(setTagOptionsMap, initialTagOptions)
    }
  }, [initialTagOptions, registerPickerOptions])

  const resolveCategoryLabel = React.useCallback(
    (id: string) => categoryOptionsMap[id]?.label ?? id,
    [categoryOptionsMap],
  )
  const resolveCategoryDescription = React.useCallback(
    (id: string) => categoryOptionsMap[id]?.description ?? null,
    [categoryOptionsMap],
  )
  const resolveChannelLabel = React.useCallback(
    (id: string) => channelOptionsMap[id]?.label ?? id,
    [channelOptionsMap],
  )
  const resolveChannelDescription = React.useCallback(
    (id: string) => channelOptionsMap[id]?.description ?? null,
    [channelOptionsMap],
  )
  const resolveTagLabel = React.useCallback((id: string) => tagOptionsMap[id]?.label ?? id, [tagOptionsMap])

  const loadCategorySuggestions = React.useCallback(
    async (term?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '200', view: 'manage' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; parentName?: string | null }> }>(
          `/api/catalog/categories?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.categoriesLoadError', 'Failed to load categories') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const parentName =
              typeof entry.parentName === 'string' && entry.parentName.trim().length ? entry.parentName : null
            const label = formatCategoryLabel(
              typeof entry.name === 'string' ? entry.name : null,
              value,
              parentName,
            )
            const description =
              parentName && !label.toLowerCase().includes(parentName.toLowerCase()) ? parentName : null
            return { value, label, description }
          })
          .filter(
            (
              option: { value: string; label: string; description: string | null } | null,
            ): option is { value: string; label: string; description: string | null } => !!option,
          )
        registerPickerOptions(setCategoryOptionsMap, options)
        return options
      } catch {
        return []
      }
    },
    [registerPickerOptions, t],
  )

  const loadChannelSuggestions = React.useCallback(
    async (term?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '100', isActive: 'true' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; code?: string }> }>(
          `/api/sales/channels?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.channelsLoadError', 'Failed to load channels') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label =
              typeof entry.name === 'string' && entry.name.trim().length
                ? entry.name
                : typeof entry.code === 'string' && entry.code.trim().length
                  ? entry.code
                  : value
            const description = typeof entry.code === 'string' && entry.code.trim().length ? entry.code : null
            return { value, label, description }
          })
          .filter(
            (
              option: { value: string; label: string; description: string | null } | null,
            ): option is { value: string; label: string; description: string | null } => !!option,
          )
        registerPickerOptions(setChannelOptionsMap, options)
        return options
      } catch {
        return []
      }
    },
    [registerPickerOptions, t],
  )

  const loadTagSuggestions = React.useCallback(
    async (term?: string) => {
      try {
        const params = new URLSearchParams({ pageSize: '100' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ label?: string }> }>(
          `/api/catalog/tags?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.tagsLoadError', 'Failed to load tags') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : ''
            if (!rawLabel) return null
            return { value: rawLabel, label: rawLabel }
          })
          .filter(
            (option: { value: string; label: string } | null): option is { value: string; label: string } => !!option,
          )
        registerPickerOptions(setTagOptionsMap, options)
        return options
      } catch {
        return []
      }
    },
    [registerPickerOptions, t],
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>{t('catalog.products.create.organize.categoriesLabel', 'Categories')}</Label>
        <TagsInput
          value={Array.isArray(values.categoryIds) ? values.categoryIds : []}
          onChange={(next) => setValue('categoryIds', next)}
          suggestions={categorySuggestions}
          loadSuggestions={loadCategorySuggestions}
          allowCustomValues={false}
          resolveLabel={resolveCategoryLabel}
          resolveDescription={resolveCategoryDescription}
          placeholder={t('catalog.products.create.organize.categoriesPlaceholder', 'Search categories')}
        />
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.organize.categoriesHelp', 'Assign products to one or more taxonomy nodes.')}
        </p>
        {errors.categoryIds ? <p className="text-xs text-red-600">{errors.categoryIds}</p> : null}
      </div>

      <div className="space-y-2">
        <Label>{t('catalog.products.create.organize.channelsLabel', 'Sales channels')}</Label>
        <TagsInput
          value={Array.isArray(values.channelIds) ? values.channelIds : []}
          onChange={(next) => setValue('channelIds', next)}
          suggestions={channelSuggestions}
          loadSuggestions={loadChannelSuggestions}
          allowCustomValues={false}
          resolveLabel={resolveChannelLabel}
          resolveDescription={resolveChannelDescription}
          placeholder={t('catalog.products.create.organize.channelsPlaceholder', 'Pick channels')}
        />
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.organize.channelsHelp', 'Selected channels will receive default offers for this product.')}
        </p>
        {errors.channelIds ? <p className="text-xs text-red-600">{errors.channelIds}</p> : null}
      </div>

      <div className="space-y-2">
        <Label>{t('catalog.products.create.organize.tagsLabel', 'Tags')}</Label>
        <TagsInput
          value={Array.isArray(values.tags) ? values.tags : []}
          onChange={(next) => setValue('tags', next)}
          suggestions={tagSuggestions}
          loadSuggestions={loadTagSuggestions}
          resolveLabel={resolveTagLabel}
          placeholder={t('catalog.products.create.organize.tagsPlaceholder', 'Add tag and press Enter')}
        />
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.organize.tagsHelp', 'Describe products with shared labels to build quick filters.')}
        </p>
        {errors.tags ? <p className="text-xs text-red-600">{errors.tags}</p> : null}
      </div>
    </div>
  )
}
