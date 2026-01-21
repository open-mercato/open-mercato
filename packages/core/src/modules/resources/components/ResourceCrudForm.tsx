"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { DictionarySelectControl } from '@open-mercato/core/modules/dictionaries/components/DictionarySelectControl'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { AttachmentsSection, TagsSection, type TagOption, type TagsSectionLabels } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/resources/lib/capacityUnits'
import { RESOURCES_RESOURCE_FIELDSET_DEFAULT, resolveResourcesResourceFieldsetCode } from '@open-mercato/core/modules/resources/lib/resourceCustomFields'
import Link from 'next/link'
import { Plus, Settings } from 'lucide-react'

const DEFAULT_PAGE_SIZE = 100

type ResourceTypeRow = {
  id: string
  name: string
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

type ResourceTagsSectionConfig = {
  title: string
  tags: TagOption[]
  onChange: (next: TagOption[]) => void
  loadOptions: (query?: string) => Promise<TagOption[]>
  createTag: (label: string) => Promise<TagOption>
  onSave: (payload: { next: TagOption[]; added: TagOption[]; removed: TagOption[] }) => Promise<void>
  labels: TagsSectionLabels
}

export type ResourcesResourceFormConfig = {
  fields: CrudField[]
  groups: CrudFormGroup[]
  resolveFieldsetCode: (resourceTypeId?: string | null) => string
  resourceTypesLoaded: boolean
}

export function useResourcesResourceFormConfig(options: {
  tagsSection?: ResourceTagsSectionConfig
} = {}): ResourcesResourceFormConfig {
  const { tagsSection } = options
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [resourceTypes, setResourceTypes] = React.useState<ResourceTypeRow[]>([])
  const [resourceTypesLoaded, setResourceTypesLoaded] = React.useState(false)
  const [capacityUnitDictionaryId, setCapacityUnitDictionaryId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function loadResourceTypes() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: String(DEFAULT_PAGE_SIZE) })
        const call = await apiCall<ResourceTypesResponse>(`/api/resources/resource-types?${params.toString()}`)
        if (!cancelled) {
          const items = Array.isArray(call.result?.items) ? call.result.items : []
          setResourceTypes(items)
        }
      } catch {
        if (!cancelled) setResourceTypes([])
      } finally {
        if (!cancelled) setResourceTypesLoaded(true)
      }
    }
    loadResourceTypes()
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    async function loadCapacityUnitDictionary() {
      try {
        const call = await apiCall<{ items?: Array<{ id?: string; key?: string; isInherited?: boolean }> }>('/api/dictionaries')
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const matches = items.filter((item) => item?.key === RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY)
        const preferred = matches.find((item) => item?.isInherited === false) ?? matches[0] ?? null
        if (!cancelled) setCapacityUnitDictionaryId(preferred?.id ?? null)
      } catch {
        if (!cancelled) setCapacityUnitDictionaryId(null)
      }
    }
    loadCapacityUnitDictionary()
    return () => { cancelled = true }
  }, [scopeVersion])

  const resourceFieldsetByTypeId = React.useMemo(() => {
    const map = new Map<string, string>()
    resourceTypes.forEach((type) => {
      map.set(type.id, resolveResourcesResourceFieldsetCode(type.name))
    })
    return map
  }, [resourceTypes])

  const resolveFieldsetCode = React.useCallback((resourceTypeId?: string | null) => {
    if (!resourceTypeId) return RESOURCES_RESOURCE_FIELDSET_DEFAULT
    return resourceFieldsetByTypeId.get(resourceTypeId) ?? RESOURCES_RESOURCE_FIELDSET_DEFAULT
  }, [resourceFieldsetByTypeId])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('resources.resources.form.appearance.colorLabel', 'Color'),
    colorHelp: t('resources.resources.form.appearance.colorHelp', 'Pick a color for this resource.'),
    colorClearLabel: t('resources.resources.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('resources.resources.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('resources.resources.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('resources.resources.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('resources.resources.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('resources.resources.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('resources.resources.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('resources.resources.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('resources.resources.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => {
    const baseFields: CrudField[] = [
      { id: 'name', label: t('resources.resources.form.fields.name', 'Name'), type: 'text', required: true },
      {
        id: 'description',
        label: t('resources.resources.form.fields.description', 'Description'),
        type: 'richtext',
        editor: 'uiw',
      },
      {
        id: 'resourceTypeId',
        label: t('resources.resources.form.fields.type', 'Resource type'),
        type: 'custom',
        component: ({ value, setValue, setFormValue, disabled }) => (
          <div className="flex items-center gap-2">
            <select
              className="h-9 w-full rounded border px-2 text-sm"
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => {
                const next = event.target.value || ''
                setValue(next)
                if (setFormValue) {
                  setFormValue('customFieldsetCode', resolveFieldsetCode(next || null))
                }
              }}
              data-crud-focus-target=""
              disabled={disabled}
            >
              <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
              {resourceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <Button
              asChild
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              title={t('resources.resources.form.fields.type.manage', 'Manage resource types')}
              aria-label={t('resources.resources.form.fields.type.manage', 'Manage resource types')}
              disabled={disabled}
            >
              <Link href="/backend/resources/resource-types">
                <Settings className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              title={t('resources.resources.form.fields.type.add', 'Add resource type')}
              aria-label={t('resources.resources.form.fields.type.add', 'Add resource type')}
              disabled={disabled}
            >
              <Link href="/backend/resources/resource-types/create">
                <Plus className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        ),
      },
      {
        id: 'capacity',
        label: t('resources.resources.form.fields.capacity', 'Capacity'),
        description: t(
          'resources.resources.form.fields.capacity.help',
          'Depends on the resource and can mean spots, units, quantity, or another type of capacity.',
        ),
        type: 'number',
      },
      {
        id: 'capacityUnitValue',
        label: t('resources.resources.form.fields.capacityUnit', 'Capacity unit'),
        type: 'custom',
        component: ({ value, setValue }) => {
          if (!capacityUnitDictionaryId) {
            return (
              <p className="text-xs text-muted-foreground">
                {t('resources.resources.form.fields.capacityUnit.missing', 'Capacity unit dictionary is not configured.')}
              </p>
            )
          }
          return (
            <DictionarySelectControl
              dictionaryId={capacityUnitDictionaryId}
              value={typeof value === 'string' ? value : null}
              onChange={(next) => setValue(next ?? '')}
              selectClassName="w-full"
            />
          )
        },
      },
      {
        id: 'appearance',
        label: t('resources.resources.form.appearance.label', 'Appearance'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => {
          const appearance = value && typeof value === 'object'
            ? value as { icon?: string | null; color?: string | null }
            : {}
          return (
            <AppearanceSelector
              icon={appearance.icon ?? null}
              color={appearance.color ?? null}
              onIconChange={(next) => setValue({ ...appearance, icon: next })}
              onColorChange={(next) => setValue({ ...appearance, color: next })}
              labels={appearanceLabels}
              disabled={disabled}
            />
          )
        },
      },
    ]

    baseFields.push({
      id: 'isActive',
      label: t('resources.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    })

    return baseFields
  }, [
    appearanceLabels,
    capacityUnitDictionaryId,
    resolveFieldsetCode,
    resourceTypes,
    t,
  ])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const baseGroups: CrudFormGroup[] = [
      {
        id: 'details',
        column: 1,
        fields: [
          'name',
          'description',
          'resourceTypeId',
          'capacity',
          'capacityUnitValue',
          'appearance',
          'isActive',
        ],
      },
      {
        id: 'custom',
        title: t('entities.customFields.title', 'Custom Attributes'),
        column: 2,
        kind: 'customFields',
      },
    ]

    if (tagsSection) {
      baseGroups.push({
        id: 'tags',
        column: 2,
        bare: true,
        component: () => (
          <TagsSection
            title={tagsSection.title}
            tags={tagsSection.tags}
            onChange={tagsSection.onChange}
            loadOptions={tagsSection.loadOptions}
            createTag={tagsSection.createTag}
            onSave={tagsSection.onSave}
            labels={tagsSection.labels}
          />
        ),
      })
    }

    return baseGroups
  }, [tagsSection, t])

  return { fields, groups, resolveFieldsetCode, resourceTypesLoaded }
}

export type ResourcesResourceFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  successRedirect?: string
  initialValues?: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
  formConfig: ResourcesResourceFormConfig
}

export function ResourcesResourceForm(props: ResourcesResourceFormProps) {
  const {
    title,
    submitLabel,
    backHref,
    cancelHref,
    successRedirect,
    initialValues,
    onSubmit,
    onDelete,
    isLoading,
    loadingMessage,
    formConfig,
  } = props
  const t = useT()
  const recordId = typeof initialValues?.id === 'string' ? initialValues.id : null
  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const attachmentsGroup: CrudFormGroup = {
      id: 'attachments',
      title: t('attachments.library.title', 'Attachments'),
      column: 1,
      component: () => (
        <AttachmentsSection
          entityId={E.resources.resources_resource}
          recordId={recordId}
        />
      ),
    }
    return [...formConfig.groups, attachmentsGroup]
  }, [formConfig.groups, recordId, t])

  return (
    <CrudForm
      title={title}
      backHref={backHref}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      successRedirect={successRedirect}
      fields={formConfig.fields}
      groups={groups}
      initialValues={initialValues}
      entityId={E.resources.resources_resource}
      customFieldsetBindings={{ [E.resources.resources_resource]: { valueKey: 'customFieldsetCode' } }}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
  )
}
