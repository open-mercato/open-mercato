"use client"
import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '../primitives/button'
import { DataLoader } from '../primitives/DataLoader'
import { flash } from './FlashMessages'
import dynamic from 'next/dynamic'
import remarkGfm from 'remark-gfm'
import {
  Trash2,
  Save,
  Settings,
  Layers,
  Tag,
  Sparkles,
  Package,
  Shirt,
  Grid,
  ShoppingBag,
  ShoppingCart,
  Store,
  Users,
  Briefcase,
  Building,
  BookOpen,
  Bookmark,
  Camera,
  Car,
  Clock,
  Cloud,
  Compass,
  CreditCard,
  Database,
  Flame,
  Gift,
  Globe,
  Heart,
  Key,
  Map as MapIcon,
  Palette,
  Shield,
  Star,
  Truck,
  Zap,
  Coins,
} from 'lucide-react'
import { loadGeneratedFieldRegistrations } from './fields/registry'
import type { CustomFieldDefDto, CustomFieldDefinitionsPayload, CustomFieldsetDto } from './utils/customFieldDefs'
import { buildFormFieldsFromCustomFields, buildFormFieldFromCustomFieldDef } from './utils/customFieldForms'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TagsInput } from './inputs/TagsInput'
import { ComboboxInput } from './inputs/ComboboxInput'
import { mapCrudServerErrorToFormErrors, parseServerMessage } from './utils/serverErrors'
import type { CustomFieldDefLike } from '@open-mercato/shared/modules/entities/validation'
import type { MDEditorProps as UiWMDEditorProps } from '@uiw/react-md-editor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../primitives/dialog'
import { FieldDefinitionsManager, type FieldDefinitionsManagerHandle } from './custom-fields/FieldDefinitionsManager'
import { useInjectionSpotEvents, InjectionSpot, useInjectionWidgets } from './injection/InjectionSpot'

// Stable empty options array to avoid creating a new [] every render
const EMPTY_OPTIONS: CrudFieldOption[] = []
const FOCUSABLE_SELECTOR =
  '[data-crud-focus-target], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type CrudFieldBase = {
  id: string
  label: string
  placeholder?: string
  description?: string // inline field-level help
  required?: boolean
  layout?: 'full' | 'half' | 'third'
  disabled?: boolean
}

export type CrudFieldOption = { value: string; label: string }

export type CrudBuiltinField = CrudFieldBase & {
  type:
    | 'text'
    | 'textarea'
    | 'checkbox'
    | 'select'
    | 'number'
    | 'date'
    | 'tags'
    | 'richtext'
    | 'relation'
    | 'combobox'
  placeholder?: string
  options?: CrudFieldOption[]
  multiple?: boolean
  listbox?: boolean
  // for relation/select style fields; if provided, options are loaded on mount
  loadOptions?: (query?: string) => Promise<CrudFieldOption[]>
  // when type === 'richtext', choose editor implementation
  editor?: 'simple' | 'uiw' | 'html'
  // for text fields; provides datalist suggestions while allowing free-text input
  suggestions?: string[]
  // for combobox fields; allow custom values or restrict to suggestions only
  allowCustomValues?: boolean
}

export type CrudCustomFieldRenderProps = {
  id: string
  value: unknown
  error?: string
  autoFocus?: boolean
  disabled?: boolean
  values?: Record<string, unknown>
  setValue: (value: unknown) => void
  // Optional helper to update other form values from within a custom field
  setFormValue?: (id: string, value: unknown) => void
  // Optional context for advanced custom inputs
  entityId?: string
  recordId?: string
}

export type CrudCustomField = CrudFieldBase & {
  type: 'custom'
  component: (props: CrudCustomFieldRenderProps) => React.ReactNode
}

export type CrudField = CrudBuiltinField | CrudCustomField

type CrudFormValues<TValues extends Record<string, unknown>> = Partial<TValues> & Record<string, unknown>

export type CrudFormProps<TValues extends Record<string, unknown>> = {
  schema?: z.ZodType<TValues>
  fields: CrudField[]
  initialValues?: Partial<TValues>
  submitLabel?: string
  customFieldsLoadingMessage?: string
  cancelHref?: string
  successRedirect?: string
  deleteRedirect?: string
  onSubmit?: (values: TValues) => Promise<void> | void
  onDelete?: () => Promise<void> | void
  // When true, shows Delete button whenever onDelete is provided, even without an id
  deleteVisible?: boolean
  // Legacy field-only grid toggle. Use `groups` for advanced layout.
  twoColumn?: boolean
  title?: string
  backHref?: string
  // Optional extra action buttons rendered next to Delete/Cancel/Save
  // Useful for custom links like "Show Records" etc.
  extraActions?: React.ReactNode
  // When provided, CrudForm will fetch custom field definitions and append
  // form-editable custom fields automatically to the provided `fields`.
  entityId?: string
  entityIds?: string[]
  // Optional grouped layout rendered in two responsive columns (1 on mobile).
  groups?: CrudFormGroup[]
  // Loading state for the entire form (e.g., when loading record data)
  isLoading?: boolean
  loadingMessage?: string
  // User-defined entity mode: all fields are custom, use bare keys (no cf_)
  customEntity?: boolean
  // Embedded mode hides outer chrome; useful for inline sections
  embedded?: boolean
  // Optional custom content injected between the header actions and the form body
  contentHeader?: React.ReactNode
  // Optional mapping of entityId -> form value key storing the selected fieldset code
  customFieldsetBindings?: Record<string, { valueKey: string }>
  // Optional injection spot ID for widget injection
  injectionSpotId?: string
}

// Group-level custom component context
export type CrudFormGroupComponentProps = {
  values: Record<string, unknown>
  setValue: (id: string, v: unknown) => void
  errors: Record<string, string>
}

// Special group kind for automatic Custom Fields section
export type CrudFormGroup = {
  id: string
  title?: string
  column?: 1 | 2
  description?: string
  // Either list field ids, inline field configs, or mix of both
  fields?: (CrudField | string)[]
  // Inject a custom component into the group card
  component?: (ctx: CrudFormGroupComponentProps) => React.ReactNode
  // When kind === 'customFields', the group renders form-editable custom fields
  kind?: 'customFields'
  // When true, render component output inline without wrapping group chrome
  bare?: boolean
}

const FIELDSET_ICON_COMPONENTS: Record<string, React.ComponentType<{ className?: string }>> = {
  layers: Layers,
  tag: Tag,
  sparkles: Sparkles,
  package: Package,
  shirt: Shirt,
  grid: Grid,
  shoppingBag: ShoppingBag,
  shoppingCart: ShoppingCart,
  store: Store,
  users: Users,
  briefcase: Briefcase,
  building: Building,
  bookOpen: BookOpen,
  bookmark: Bookmark,
  camera: Camera,
  car: Car,
  clock: Clock,
  cloud: Cloud,
  compass: Compass,
  creditCard: CreditCard,
  database: Database,
  flame: Flame,
  gift: Gift,
  globe: Globe,
  heart: Heart,
  key: Key,
  map: MapIcon,
  palette: Palette,
  shield: Shield,
  star: Star,
  truck: Truck,
  zap: Zap,
  coins: Coins,
}

type CustomFieldGroupLayout = {
  code: string | null
  label?: string
  hint?: string
  fields: CrudField[]
}

type CustomFieldSectionLayout = {
  entityId: string
  fieldsetCode: string | null
  fieldset?: CustomFieldsetDto
  title: string
  description?: string
  groups: CustomFieldGroupLayout[]
}

type CustomFieldEntityLayout = {
  entityId: string
  sections: CustomFieldSectionLayout[]
  availableFieldsets: CustomFieldsetDto[]
  singleFieldsetPerRecord: boolean
  hasFieldsets: boolean
  activeFieldset: string | null
}

export function CrudForm<TValues extends Record<string, unknown>>({
  schema,
  fields,
  initialValues,
  submitLabel,
  customFieldsLoadingMessage,
  cancelHref,
  successRedirect,
  deleteRedirect,
  onSubmit,
  onDelete,
  deleteVisible,
  twoColumn = false,
  title,
  backHref,
  entityId,
  entityIds,
  groups,
  isLoading = false,
  loadingMessage,
  customEntity = false,
  embedded = false,
  extraActions,
  contentHeader,
  customFieldsetBindings,
  injectionSpotId,
}: CrudFormProps<TValues>) {
  // Ensure module field components are registered (client-side)
  React.useEffect(() => { loadGeneratedFieldRegistrations().catch(() => {}) }, [])
  const router = useRouter()
  const t = useT()
  const resolvedSubmitLabel = submitLabel ?? t('ui.forms.actions.save')
  const resolvedLoadingMessage = loadingMessage ?? t('ui.forms.loading')
  const resolvedCustomFieldsLoadingMessage = customFieldsLoadingMessage ?? resolvedLoadingMessage
  const cancelLabel = t('ui.forms.actions.cancel')
  const deleteLabel = t('ui.forms.actions.delete')
  const savingLabel = t('ui.forms.status.saving')
  const backLabel = t('ui.navigation.back')
  const customFieldsLabel = t('entities.customFields.title')
  const fieldsetSelectorLabel = t('entities.customFields.fieldsetSelectorLabel', 'Fieldset')
  const emptyFieldsetMessage = t('entities.customFields.emptyFieldset', 'No fields defined for this fieldset.')
  const defaultFieldsetLabel = t('entities.customFields.defaultFieldset', 'Default')
  const manageFieldsetLabel = t('entities.customFields.manageFieldset', 'Manage fields')
  const fieldsetDialogTitle = t('entities.customFields.manageDialogTitle', 'Edit custom fields')
  const fieldsetDialogUnavailable = t('entities.customFields.manageDialogUnavailable', 'Field definitions page is unavailable.')
  const deleteConfirmMessage = t('ui.forms.confirmDelete')
  const deleteSuccessMessage = t('ui.forms.flash.deleteSuccess')
  const deleteErrorMessage = t('ui.forms.flash.deleteError')
  const saveErrorMessage = t('ui.forms.flash.saveError')
  const formId = React.useId()
  const [values, setValues] = React.useState<CrudFormValues<TValues>>(
    () => ({ ...(initialValues ?? {}) } as CrudFormValues<TValues>)
  )
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [dynamicOptions, setDynamicOptions] = React.useState<Record<string, CrudFieldOption[]>>({})
  const [cfDefinitions, setCfDefinitions] = React.useState<CustomFieldDefDto[]>([])
  const [cfMetadata, setCfMetadata] = React.useState<CustomFieldDefinitionsPayload | null>(null)
  const [cfFieldsetSelections, setCfFieldsetSelections] = React.useState<Record<string, string | null>>({})
  const [isLoadingCustomFields, setIsLoadingCustomFields] = React.useState(false)
  const [customFieldDefsVersion, setCustomFieldDefsVersion] = React.useState(0)
  const [fieldsetEditorTarget, setFieldsetEditorTarget] = React.useState<{ entityId: string; fieldsetCode: string | null; view: 'entity' | 'fieldset' } | null>(null)
  const [isInDialog, setIsInDialog] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const fieldsetManagerRef = React.useRef<FieldDefinitionsManagerHandle | null>(null)
  const resolvedEntityIds = React.useMemo(() => {
    if (Array.isArray(entityIds) && entityIds.length) {
      const dedup = new Set<string>()
      const list: string[] = []
      entityIds.forEach((id) => {
        const trimmed = typeof id === 'string' ? id.trim() : ''
        if (!trimmed || dedup.has(trimmed)) return
        dedup.add(trimmed)
        list.push(trimmed)
      })
      return list
    }
    if (typeof entityId === 'string' && entityId.trim().length > 0) {
      return [entityId.trim()]
    }
    return []
  }, [entityId, entityIds])
  const primaryEntityId = resolvedEntityIds.length ? resolvedEntityIds[0] : null
  
  // Injection spot events for widget lifecycle management
  const injectionContext = React.useMemo(() => ({
    formId,
    entityId: primaryEntityId,
    isLoading,
    pending,
  }), [formId, primaryEntityId, isLoading, pending])
  
  const { widgets: injectionWidgets } = useInjectionWidgets(injectionSpotId, {
    context: injectionContext,
    triggerOnLoad: true,
  })
  
  const { triggerEvent: triggerInjectionEvent } = useInjectionSpotEvents(injectionSpotId ?? '', injectionWidgets)
  
  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    setIsInDialog(Boolean(root.closest('[data-dialog-content]')))
  }, [])
  const dialogFooterClass = isInDialog
    ? 'sticky bottom-0 left-0 right-0 z-20 -mx-6 px-6 bg-card border-t border-border/70 py-2 sm:-mx-6 sm:px-6'
    : ''
  const dialogFormPadding = isInDialog ? 'pb-4' : ''

  const buildCustomFieldsManageHref = React.useCallback(
    (targetEntityId: string | null) => {
      if (!targetEntityId) return null
      try {
        const encoded = encodeURIComponent(targetEntityId)
        return customEntity ? `/backend/entities/user/${encoded}` : `/backend/entities/system/${encoded}`
      } catch {
        return null
      }
    },
    [customEntity],
  )

  const refreshCustomFieldDefinitions = React.useCallback(() => {
    setCustomFieldDefsVersion((prev) => prev + 1)
  }, [])

  const recordId = React.useMemo(() => {
    const raw = values.id
    if (typeof raw === 'string') return raw
    if (typeof raw === 'number') return String(raw)
    return undefined
  }, [values])
  // Unified delete handler with confirmation
  const handleDelete = React.useCallback(async () => {
    if (!onDelete) return
    try {
      const ok = typeof window !== 'undefined' ? window.confirm(deleteConfirmMessage) : true
      if (!ok) return
      await onDelete()
      try { flash(deleteSuccessMessage, 'success') } catch {}
      // Redirect if requested by caller
      if (typeof deleteRedirect === 'string' && deleteRedirect) {
        router.push(deleteRedirect)
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : deleteErrorMessage
      try { flash(message, 'error') } catch {}
    }
  }, [onDelete, deleteRedirect, router, deleteConfirmMessage, deleteSuccessMessage, deleteErrorMessage])
  
  // Determine whether this form is creating a new record (no `id` yet)
  const isNewRecord = React.useMemo(() => {
    const rawId = values.id
    if (rawId === undefined || rawId === null) return true
    return typeof rawId === 'string' ? rawId.trim().length === 0 : false
  }, [values])
  const showDelete = Boolean(onDelete) && (typeof deleteVisible === 'boolean' ? deleteVisible : !isNewRecord)

  // Auto-append custom fields for this entityId
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!resolvedEntityIds.length) { 
        setCfDefinitions([])
        setCfMetadata(null)
        setIsLoadingCustomFields(false)
        return 
      }
      
      setIsLoadingCustomFields(true)
      try {
        const mod = await import('./utils/customFieldForms')
        const { definitions, metadata } = await mod.fetchCustomFieldFormStructure(resolvedEntityIds, undefined, { bareIds: customEntity })
        if (!cancelled) {
          setCfDefinitions(definitions)
          setCfMetadata(metadata)
          setCfFieldsetSelections((prev) => {
            const next: Record<string, string | null> = {}
            let changed = false
            resolvedEntityIds.forEach((entityId) => {
              const existing = prev[entityId]
              const fieldsets = metadata.fieldsetsByEntity?.[entityId] ?? []
              const defaultSelection = fieldsets[0]?.code ?? null
              const value = existing !== undefined ? existing : defaultSelection
              next[entityId] = value
              if (existing !== value) changed = true
            })
            if (Object.keys(prev).length !== Object.keys(next).length) changed = true
            return changed ? next : prev
          })
          setIsLoadingCustomFields(false)
        }
      } catch {
        if (!cancelled) {
          setCfDefinitions([])
          setCfMetadata(null)
          setIsLoadingCustomFields(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [resolvedEntityIds, customEntity, customFieldDefsVersion])

  React.useEffect(() => {
    if (!customFieldsetBindings) return
    setCfFieldsetSelections((prev) => {
      let changed = false
      const next = { ...prev }
      resolvedEntityIds.forEach((entityId) => {
        const binding = customFieldsetBindings[entityId]
        if (!binding) return
        const raw = values[binding.valueKey]
        if (typeof raw === 'string' && raw.trim().length > 0) {
          const normalized = raw.trim()
          if (next[entityId] !== normalized) {
            next[entityId] = normalized
            changed = true
          }
        }
      })
      return changed ? next : prev
    })
  }, [customFieldsetBindings, resolvedEntityIds, values])

  const fieldsetsByEntity = cfMetadata?.fieldsetsByEntity ?? {}
  const entitySettings = cfMetadata?.entitySettings ?? {}

  const { cfFields, customFieldLayout } = React.useMemo(() => {
    if (!cfDefinitions.length) return { cfFields: [], customFieldLayout: [] as CustomFieldEntityLayout[] }
    const aggregated: CrudField[] = []
    const layout: CustomFieldEntityLayout[] = []
    const defsByEntity = new globalThis.Map<string, CustomFieldDefDto[]>()
    cfDefinitions.forEach((def) => {
      const entityId = typeof def.entityId === 'string' && def.entityId.trim().length
        ? def.entityId.trim()
        : resolvedEntityIds[0]
      if (!entityId) return
      const bucket = defsByEntity.get(entityId) ?? []
      bucket.push(def)
      defsByEntity.set(entityId, bucket)
    })

    const buildSection = (
      entityId: string,
      fieldsetCode: string | null,
      defList: CustomFieldDefDto[],
      fieldset?: CustomFieldsetDto,
    ): CustomFieldSectionLayout | null => {
      if (!defList.length) return null
      const groupsMap = new globalThis.Map<string, CustomFieldGroupLayout>()
      const order: string[] = []
      const fieldsetGroupMap = new globalThis.Map<string, { title?: string; hint?: string; code: string }>()
      if (Array.isArray(fieldset?.groups)) {
        fieldset.groups.forEach((group) => {
          if (!group?.code) return
          fieldsetGroupMap.set(group.code, { code: group.code, title: group.title, hint: group.hint })
        })
      }
      const sortedDefs = [...defList].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      const ensureBucket = (code: string | null, def: CustomFieldDefDto): CustomFieldGroupLayout => {
        const key = code ?? '__default__'
        let bucket = groupsMap.get(key)
        if (!bucket) {
          const fallbackMeta = code ? fieldsetGroupMap.get(code) : undefined
          const directMeta = code ? def.group : undefined
          const label =
            code === null
              ? undefined
              : directMeta?.title || fallbackMeta?.title || directMeta?.code || fallbackMeta?.code || code
          const hint = directMeta?.hint || fallbackMeta?.hint
          bucket = { code, label, hint, fields: [] }
          groupsMap.set(key, bucket)
          order.push(key)
        } else if (code && !bucket.label) {
          const fallbackMeta = fieldsetGroupMap.get(code)
          const directMeta = def.group ?? undefined
          bucket.label = directMeta?.title || fallbackMeta?.title || directMeta?.code || fallbackMeta?.code || bucket.label
          bucket.hint = directMeta?.hint || fallbackMeta?.hint || bucket.hint
        }
        return bucket
      }
      sortedDefs.forEach((definition) => {
        const field = buildFormFieldFromCustomFieldDef(definition, { bareIds: customEntity })
        if (!field) return
        aggregated.push(field)
        const bucket = ensureBucket(definition.group?.code ?? null, definition)
        bucket.fields.push(field)
      })
      const groups = order
        .map((key) => groupsMap.get(key)!)
        .filter((group) => group.fields.length > 0)
      if (!groups.length) return null
      return {
        entityId,
        fieldsetCode,
        fieldset,
        title: fieldset?.label ?? customFieldsLabel,
        description: fieldset?.description,
        groups,
      }
    }

    const entityIds = resolvedEntityIds.length ? resolvedEntityIds : Array.from(defsByEntity.keys())
    entityIds.forEach((entityId) => {
      const defsForEntity = defsByEntity.get(entityId) ?? []
      if (!defsForEntity.length) return
      const availableFieldsets = fieldsetsByEntity[entityId] ?? []
      const hasFieldsets = availableFieldsets.length > 0
      const singleFieldsetPerRecord =
        entitySettings[entityId]?.singleFieldsetPerRecord !== false
      const defsByFieldset = new globalThis.Map<string | null, CustomFieldDefDto[]>()
      defsForEntity.forEach((def) => {
        const code = typeof def.fieldset === 'string' && def.fieldset.trim().length > 0 ? def.fieldset.trim() : null
        const bucket = defsByFieldset.get(code) ?? []
        bucket.push(def)
        defsByFieldset.set(code, bucket)
      })
      const sections: CustomFieldSectionLayout[] = []

      const createEmptySection = (code: string | null): CustomFieldSectionLayout => {
        const fieldset = code ? availableFieldsets.find((fs) => fs.code === code) : undefined
        return {
          entityId,
          fieldsetCode: code,
          fieldset,
          title: fieldset?.label ?? customFieldsLabel,
          description: fieldset?.description,
          groups: [],
        }
      }

      if (!hasFieldsets) {
        const fallbackDefs =
          defsByFieldset.get(null) ?? Array.from(defsByFieldset.values()).flat()
        const section = buildSection(entityId, null, fallbackDefs, undefined)
        if (section) sections.push(section)
      } else if (singleFieldsetPerRecord) {
        const availableCodes = availableFieldsets.map((fs) => fs.code)
        const activeFieldset =
          cfFieldsetSelections[entityId] && availableCodes.includes(cfFieldsetSelections[entityId]!)
            ? cfFieldsetSelections[entityId]
            : availableFieldsets[0]?.code ?? null
        const targetDefs = activeFieldset ? defsByFieldset.get(activeFieldset) ?? [] : defsByFieldset.get(null) ?? []
        const targetSection = activeFieldset
          ? buildSection(
              entityId,
              activeFieldset,
              targetDefs,
              availableFieldsets.find((fs) => fs.code === activeFieldset),
            )
          : buildSection(entityId, null, targetDefs, undefined)
        if (targetSection) {
          sections.push(targetSection)
        } else if (activeFieldset) {
          sections.push(createEmptySection(activeFieldset))
        }
        const unassigned = defsByFieldset.get(null)
        if (unassigned?.length && activeFieldset) {
          const generalSection = buildSection(entityId, null, unassigned, undefined)
          if (generalSection) sections.push(generalSection)
        }
      } else {
        availableFieldsets.forEach((fieldset) => {
          const list = defsByFieldset.get(fieldset.code) ?? []
          const section = buildSection(entityId, fieldset.code, list, fieldset)
          if (section) sections.push(section)
        })
        const unassigned = defsByFieldset.get(null)
        if (unassigned?.length) {
          const section = buildSection(entityId, null, unassigned, undefined)
          if (section) sections.push(section)
        }
      }

      if (!sections.length && hasFieldsets) {
        const fallbackCode = availableFieldsets[0]?.code ?? null
        sections.push(createEmptySection(fallbackCode))
      }

      layout.push({
        entityId,
        sections,
        availableFieldsets,
        singleFieldsetPerRecord,
        hasFieldsets,
        activeFieldset: cfFieldsetSelections[entityId] ?? availableFieldsets[0]?.code ?? null,
      })
    })

    return { cfFields: aggregated, customFieldLayout: layout }
  }, [
    cfDefinitions,
    cfFieldsetSelections,
    customEntity,
    customFieldsLabel,
    entitySettings,
    fieldsetsByEntity,
    resolvedEntityIds,
  ])

  const allFields = React.useMemo(() => {
    if (!cfFields.length) return fields
    const provided = new Set(fields.map(f => f.id))
    const extras = cfFields.filter(f => !provided.has(f.id))
    return [...fields, ...extras]
  }, [fields, cfFields])

  const fieldById = React.useMemo(() => {
    return new globalThis.Map(allFields.map((f) => [f.id, f]))
  }, [allFields])
  
  const injectionGroupCards = React.useMemo<CrudFormGroup[]>(() => {
    if (!injectionWidgets || injectionWidgets.length === 0) return []
    const pairs = injectionWidgets
      .filter((widget) => (widget.placement?.kind ?? 'group') === 'group')
      .map((widget) => {
        const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
        const group: CrudFormGroup = {
          id: `widget:${widget.widgetId}`,
          title: widget.placement?.groupLabel ?? widget.module.metadata.title,
          description: widget.placement?.groupDescription ?? widget.module.metadata.description,
          column: widget.placement?.column === 2 ? 2 : 1,
          component: () => (
            <widget.module.Widget
              context={injectionContext}
              data={values as unknown as CrudFormValues<TValues>}
              onDataChange={(next) => setValues(next as CrudFormValues<TValues>)}
              disabled={pending}
            />
          ),
        }
        return { group, priority }
      })
    pairs.sort((a, b) => b.priority - a.priority)
    return pairs.map((p) => p.group)
  }, [injectionWidgets, injectionContext, pending, setValues, values])
  
  const shouldAutoGroup = (!groups || groups.length === 0) && injectionGroupCards.length > 0
  const resolvedGroupsForLayout = React.useMemo(() => {
    const baseGroups = groups && groups.length ? groups : []
    const autoGroup = shouldAutoGroup ? [{ id: '__auto-fields__', fields: allFields }] as CrudFormGroup[] : []
    return [...(baseGroups.length ? baseGroups : autoGroup), ...injectionGroupCards]
  }, [allFields, groups, injectionGroupCards, shouldAutoGroup])
  const useGroupedLayout = resolvedGroupsForLayout.length > 0
  const stackedInjectionWidgets = React.useMemo(
    () => (injectionWidgets ?? []).filter((widget) => (widget.placement?.kind ?? 'stack') === 'stack'),
    [injectionWidgets],
  )

  const resolveGroupFields = React.useCallback((g: CrudFormGroup): CrudField[] => {
    if (g.kind === 'customFields') {
      return cfFields
    }

    const src = g.fields || []
    const result: CrudField[] = []

    for (const item of src) {
      if (typeof item === 'string') {
        const found = fieldById.get(item)
        if (found) result.push(found)
      } else if (item) {
        result.push(item as CrudField)
      }
    }

    return result
  }, [cfFields, fieldById])

  const customFieldsManageHref = React.useMemo(() => buildCustomFieldsManageHref(primaryEntityId), [buildCustomFieldsManageHref, primaryEntityId])

  const customFieldsEmptyState = React.useMemo(() => {
    const text = t('entities.customFields.empty')
    const action = t('entities.customFields.addFirst')
    return (
      <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/10 px-3 py-4 text-sm text-muted-foreground">
        <span>{text} </span>
        {customFieldsManageHref ? (
          <Link href={customFieldsManageHref} className="font-medium text-primary hover:underline">
            {action}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{action}</span>
        )}
      </div>
    )
  }, [customFieldsManageHref, t])

  const firstFieldId = React.useMemo(() => {
    if (useGroupedLayout) {
      const col1: CrudFormGroup[] = []
      const col2: CrudFormGroup[] = []

      for (const g of resolvedGroupsForLayout) {
        if ((g.column ?? 1) === 2) col2.push(g)
        else col1.push(g)
      }

      const scan = (list: CrudFormGroup[]) => {
        for (const group of list) {
          const resolved = resolveGroupFields(group)
          for (const field of resolved) {
            if (field?.id && !field.disabled) return field.id
          }
        }
        return null as string | null
      }

      const fromCol1 = scan(col1)
      if (fromCol1) return fromCol1
      const fromCol2 = scan(col2)
      if (fromCol2) return fromCol2
    }

    for (const field of allFields) {
      if (field?.id && !field.disabled) return field.id
    }
    return null
  }, [allFields, resolveGroupFields, resolvedGroupsForLayout, useGroupedLayout])

  const requestSubmit = React.useCallback(() => {
    if (typeof document === 'undefined') return
    const form = document.getElementById(formId) as HTMLFormElement | null
    form?.requestSubmit()
  }, [formId])

  const lastFocusedFieldRef = React.useRef<string | null>(null)
  const lastErrorFieldRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    if (isLoading || isLoadingCustomFields) {
      lastFocusedFieldRef.current = null
      return
    }

    if (!firstFieldId) return
    if (lastFocusedFieldRef.current === firstFieldId) return

    const run = () => {
      const form = document.getElementById(formId)
      if (!form) return

      // Do not steal focus if the user is already interacting with any element inside the form
      const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
      if (active && form.contains(active)) {
        return
      }

      const container = form.querySelector<HTMLElement>(`[data-crud-field-id="${firstFieldId}"]`)
      const target =
        container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        form.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)

      if (target && typeof target.focus === 'function') {
        target.focus()
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          try {
            target.select()
          } catch {}
        }
        lastFocusedFieldRef.current = firstFieldId
      }
    }

    const frame =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(run)
        : window.setTimeout(run, 0)

    return () => {
      if (typeof window === 'undefined') return
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame as number)
      } else {
        window.clearTimeout(frame as number)
      }
    }
  }, [firstFieldId, formId, isLoading, isLoadingCustomFields])

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const entries = Object.entries(errors)
    if (!entries.length) {
      lastErrorFieldRef.current = null
      return
    }
    const [fieldId] = entries[0]
    if (!fieldId || lastErrorFieldRef.current === fieldId) return

    const form = document.getElementById(formId)
    if (!form) return
    const container = form.querySelector<HTMLElement>(`[data-crud-field-id="${fieldId}"]`)
    const target =
      container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      form.querySelector<HTMLElement>(`[name="${fieldId}"]`) ??
      container ??
      null

    if (target && typeof target.focus === 'function') {
      target.focus()
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        try {
          target.select()
        } catch {}
      }
      lastErrorFieldRef.current = fieldId
    }
  }, [errors, formId])

  const setValue = React.useCallback((id: string, nextValue: unknown) => {
    setValues((prev) => {
      if (Object.is(prev[id], nextValue)) return prev
      return { ...prev, [id]: nextValue } as CrudFormValues<TValues>
    })
  }, [])

  const handleFieldsetSelectionChange = React.useCallback(
    (entityId: string, nextCode: string | null) => {
      setCfFieldsetSelections((prev) => ({ ...prev, [entityId]: nextCode }))
      const bindingKey = customFieldsetBindings?.[entityId]?.valueKey
      if (bindingKey) {
        setValue(bindingKey, nextCode ?? undefined)
      }
    },
    [customFieldsetBindings, setValue],
  )

  const handleOpenFieldsetEditor = React.useCallback(
    (entityId: string, fieldsetCode: string | null, view: 'entity' | 'fieldset' = 'entity') => {
      const href = buildCustomFieldsManageHref(entityId)
      if (!href) return
      setFieldsetEditorTarget({ entityId, fieldsetCode, view })
    },
    [buildCustomFieldsManageHref],
  )

  // Apply initialValues when provided (reapply when initialValues change for edit forms)
  React.useEffect(() => {
    if (!initialValues) return
    setValues((prev) => ({ ...prev, ...initialValues } as CrudFormValues<TValues>))
  }, [initialValues])

  const buildFieldsetEditorHref = React.useCallback(
    (includeViewParam: boolean) => {
      if (!fieldsetEditorTarget) return null
      const base = buildCustomFieldsManageHref(fieldsetEditorTarget.entityId)
      if (!base) return null
      const params: string[] = []
      if (fieldsetEditorTarget.fieldsetCode) {
        params.push(`fieldset=${encodeURIComponent(fieldsetEditorTarget.fieldsetCode)}`)
      }
      if (includeViewParam && fieldsetEditorTarget.view === 'fieldset') {
        params.push('view=fieldset')
      }
      if (!params.length) return base
      const connector = base.includes('?') ? '&' : '?'
      return `${base}${connector}${params.join('&')}`
    },
    [buildCustomFieldsManageHref, fieldsetEditorTarget],
  )

  const fieldsetEditorFullHref = React.useMemo(() => buildFieldsetEditorHref(false), [buildFieldsetEditorHref])

  const handleFieldsetDialogSave = React.useCallback(() => {
    if (!fieldsetManagerRef.current) return
    void fieldsetManagerRef.current.submit()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setErrors({})

    const requiredMessage = t('ui.forms.errors.required')
    const highlightedMessage = t('ui.forms.errors.highlighted')

    // Make sure inputs that commit on blur flush their local state before submit.
    try {
      if (typeof document !== 'undefined') {
        const activeElement = document.activeElement
        if (activeElement instanceof HTMLElement) {
          activeElement.blur()
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
    } catch {
      // ignore focus cleanup errors
    }

    // Basic required-field validation when no zod schema is provided
    const requiredErrors: Record<string, string> = {}
    for (const field of allFields) {
      if (!field.required) continue
      if (field.disabled) continue
      const v = values[field.id]
      const isArray = Array.isArray(v)
      const isString = typeof v === 'string'
      const empty =
        v === undefined ||
        v === null ||
        (isString && v.trim() === '') ||
        (isArray && v.length === 0) ||
        (field.type === 'checkbox' && v !== true)
      if (empty) requiredErrors[field.id] = requiredMessage
    }
    if (Object.keys(requiredErrors).length) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[crud-form] Required field errors prevented submit', requiredErrors)
      }
      setErrors(requiredErrors)
      flash(highlightedMessage, 'error')
      return
    }

    // Custom fields validation via definitions (rules)
    if (resolvedEntityIds.length) {
      try {
        const mod = await import('./utils/customFieldDefs')
        const defs = await mod.fetchCustomFieldDefs(resolvedEntityIds)
        const { validateValuesAgainstDefs } = await import('@open-mercato/shared/modules/entities/validation')
        // Build values keyed by def.key for validation
        const cfValues: Record<string, unknown> = {}
        if (customEntity) {
          for (const def of defs) {
            if (Object.prototype.hasOwnProperty.call(values, def.key)) {
              cfValues[def.key] = values[def.key]
            }
          }
        } else {
          for (const [k, v] of Object.entries(values)) {
            if (k.startsWith('cf_')) cfValues[k.replace(/^cf_/, '')] = v
          }
        }
        const defsForValidation = defs as unknown as CustomFieldDefLike[]
        const result = validateValuesAgainstDefs(cfValues, defsForValidation)
        if (!result.ok) {
          if (customEntity) {
            const mapped: Record<string, string> = {}
            for (const [ek, ev] of Object.entries(result.fieldErrors)) mapped[ek.replace(/^cf_/, '')] = String(ev)
            setErrors((prev) => ({ ...prev, ...mapped }))
          } else {
            setErrors((prev) => ({ ...prev, ...result.fieldErrors }))
          }
          flash(highlightedMessage, 'error')
          return
        }
      } catch {
        // ignore validation errors if helper not available
      }
    }

    let parsedValues: TValues
    if (schema) {
      const res = schema.safeParse(values)
      if (!res.success) {
        const fieldErrors: Record<string, string> = {}
        res.error.issues.forEach((issue) => {
          if (issue.path && issue.path.length) fieldErrors[String(issue.path[0])] = issue.message
        })
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[crud-form] Schema validation failed', res.error.issues)
        }
        setErrors(fieldErrors)
        flash(highlightedMessage, 'error')
        return
      }
      parsedValues = res.data
    } else {
      parsedValues = values as TValues
    }

    // Trigger onBeforeSave event for injection widgets
    if (injectionSpotId) {
      try {
        const canProceed = await triggerInjectionEvent('onBeforeSave', parsedValues, injectionContext)
        if (!canProceed) {
          flash(t('ui.forms.flash.saveBlocked', 'Save blocked by validation'), 'error')
          setPending(false)
          return
        }
      } catch (err) {
        console.error('[CrudForm] Error in onBeforeSave:', err)
        flash(t('ui.forms.flash.saveBlocked', 'Save blocked by validation'), 'error')
        setPending(false)
        return
      }
    }

    setPending(true)
    
    // Trigger onSave event for injection widgets
    if (injectionSpotId) {
      try {
        await triggerInjectionEvent('onSave', parsedValues, injectionContext)
      } catch (err) {
        console.error('[CrudForm] Error in onSave:', err)
      }
    }
    
    try {
      await onSubmit?.(parsedValues)
      
      // Trigger onAfterSave event for injection widgets
      if (injectionSpotId) {
        try {
          await triggerInjectionEvent('onAfterSave', parsedValues, injectionContext)
        } catch (err) {
          console.error('[CrudForm] Error in onAfterSave:', err)
        }
      }
      
      if (successRedirect) router.push(successRedirect)
    } catch (err: unknown) {
      const { message: helperMessage, fieldErrors: serverFieldErrors } = mapCrudServerErrorToFormErrors(err, { customEntity })
      const combinedFieldErrors = serverFieldErrors ?? {}
      const hasFieldErrors = Object.keys(combinedFieldErrors).length > 0
      const firstFieldMessage = hasFieldErrors
        ? (() => {
            const firstKey = Object.keys(combinedFieldErrors)[0]
            if (!firstKey) return null
            const value = combinedFieldErrors[firstKey]
            return typeof value === 'string' && value.trim().length ? value.trim() : null
          })()
        : null
      if (hasFieldErrors) {
        setErrors(combinedFieldErrors)
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[crud-form] Submission failed with field errors', combinedFieldErrors)
        }
      }

      let displayMessage = typeof helperMessage === 'string' && helperMessage.trim() ? helperMessage.trim() : ''
      if (hasFieldErrors) {
        const lowered = displayMessage.toLowerCase()
        const highlightedLower = highlightedMessage.toLowerCase()
        if (!displayMessage || lowered === 'invalid input' || lowered === highlightedLower) {
          displayMessage = firstFieldMessage ?? highlightedMessage
        }
      }
      if (!displayMessage && err instanceof Error && typeof err.message === 'string' && err.message.trim()) {
        displayMessage = err.message.trim()
      }
      if (!displayMessage) {
        displayMessage = hasFieldErrors ? highlightedMessage : saveErrorMessage
      }
      displayMessage = parseServerMessage(displayMessage)
      flash(displayMessage, 'error')
      setFormError(displayMessage)
    } finally {
      setPending(false)
    }
  }
  // Load dynamic options for fields that require it
  React.useEffect(() => {
    let cancelled = false
    const loadAll = async () => {
      const loaders = allFields
        .filter(
          (f): f is CrudBuiltinField & { loadOptions: NonNullable<CrudBuiltinField['loadOptions']> } =>
            f.type !== 'custom' && typeof f.loadOptions === 'function'
        )
        .map(async (f) => {
          try {
            const opts = await f.loadOptions()
            if (!cancelled) setDynamicOptions((prev) => ({ ...prev, [f.id]: opts }))
          } catch {
            // ignore
          }
        })
      await Promise.all(loaders)
    }
    loadAll()
    return () => {
      cancelled = true
    }
  }, [allFields])

  const loadFieldOptions = React.useCallback(async (field: CrudField, query?: string): Promise<CrudFieldOption[]> => {
    if (!('type' in field) || field.type === 'custom') return EMPTY_OPTIONS
    const builtin = field as CrudBuiltinField
    const loader = builtin.loadOptions
    if (typeof loader === 'function') {
      if (query === undefined && Array.isArray(dynamicOptions[field.id])) return dynamicOptions[field.id]
      try {
        const fetched = await loader(query)
        if (query === undefined) {
          setDynamicOptions((prev) => ({
            ...prev,
            [field.id]: fetched,
          }))
        }
        return fetched
      } catch {
        return builtin.options ?? EMPTY_OPTIONS
      }
    }
    return dynamicOptions[field.id] || builtin.options || EMPTY_OPTIONS
  }, [dynamicOptions])

  const fieldOptionsById = React.useMemo(() => {
    const map = new globalThis.Map<string, CrudFieldOption[]>()
    for (const f of allFields) {
      if (!('type' in f) || f.type === 'custom') continue
      const builtin = f as CrudBuiltinField
      const staticOptions = builtin.options ?? EMPTY_OPTIONS
      const dynamic = dynamicOptions[f.id]
      if (dynamic && dynamic.length) {
        const merged: CrudFieldOption[] = []
        const seen = new Set<string>()
        for (const opt of staticOptions) {
          if (seen.has(opt.value)) continue
          seen.add(opt.value)
          merged.push(opt)
        }
        for (const opt of dynamic) {
          if (seen.has(opt.value)) continue
          seen.add(opt.value)
          merged.push(opt)
        }
        map.set(f.id, merged)
      } else if (staticOptions.length) {
        map.set(f.id, staticOptions)
      } else if (dynamic) {
        map.set(f.id, dynamic)
      }
    }
    return map
  }, [allFields, dynamicOptions])

  // no auto-focus; let the browser/user manage focus

  const usesResponsiveLayout = allFields.some(
    (field) => field.layout === 'half' || field.layout === 'third'
  )
  const grid = twoColumn
    ? 'grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4'
    : usesResponsiveLayout
      ? 'grid grid-cols-1 gap-4 md:grid-cols-6'
      : 'grid grid-cols-1 gap-4'

  // Helper to render a list of field configs
  const resolveLayoutClass = (layout?: CrudFieldBase['layout']) => {
    switch (layout) {
      case 'half':
        return 'md:col-span-3'
      case 'third':
        return 'md:col-span-2'
      default:
        return 'md:col-span-6'
    }
  }

  const renderFields = (fieldList: CrudField[]) => {
    const usesResponsive = fieldList.some(
      (field) => field.layout === 'half' || field.layout === 'third'
    )
    const gridClass = usesResponsive ? 'grid grid-cols-1 gap-4 md:grid-cols-6' : 'grid grid-cols-1 gap-4'
    return (
      <div className={gridClass}>
        {fieldList.map((f) => {
          const layout = f.layout ?? 'full'
          const wrapperClassName = usesResponsive ? resolveLayoutClass(layout) : undefined
          return (
            <FieldControl
              key={f.id}
              field={f}
              value={values[f.id]}
              error={errors[f.id]}
              options={fieldOptionsById.get(f.id) || EMPTY_OPTIONS}
              setValue={setValue}
              values={values}
              loadFieldOptions={loadFieldOptions}
              autoFocus={Boolean(firstFieldId && f.id === firstFieldId)}
              onSubmitRequest={requestSubmit}
              wrapperClassName={wrapperClassName}
              entityIdForField={primaryEntityId ?? undefined}
              recordId={recordId}
            />
          )
        })}
      </div>
    )
  }

  const renderCustomFieldsContent = React.useCallback((): React.ReactNode[] => {
    if (!customFieldLayout.length) {
      return [
        <div key="custom-fields-empty" className="rounded-lg border bg-card p-4">
          {customFieldsEmptyState}
        </div>,
      ]
    }

    const nodes: React.ReactNode[] = []
    const multipleEntities = customFieldLayout.length > 1

    customFieldLayout.forEach((entityLayout) => {
      const manageHref = buildCustomFieldsManageHref(entityLayout.entityId)
      const showSelector =
        entityLayout.hasFieldsets &&
        entityLayout.singleFieldsetPerRecord &&
        entityLayout.availableFieldsets.length > 0

      if (multipleEntities) {
        nodes.push(
          <div
            key={`custom-fields-entity-${entityLayout.entityId}`}
            className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {entityLayout.entityId}
          </div>,
        )
      }

      if (showSelector) {
        nodes.push(
          <div key={`custom-fields-selector-${entityLayout.entityId}`} className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                {fieldsetSelectorLabel}
              </label>
              <select
                className="h-9 rounded border px-2 text-sm"
                value={entityLayout.activeFieldset ?? ''}
                onChange={(event) =>
                  handleFieldsetSelectionChange(
                    entityLayout.entityId,
                    event.target.value || null,
                  )}
              >
                <option value="">{defaultFieldsetLabel}</option>
                {entityLayout.availableFieldsets.map((fs) => (
                  <option key={fs.code} value={fs.code}>
                    {fs.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded border text-muted-foreground hover:text-foreground"
                onClick={() =>
                  handleOpenFieldsetEditor(entityLayout.entityId, entityLayout.activeFieldset ?? null, 'fieldset')}
                disabled={!manageHref}
                title={manageFieldsetLabel}
              >
                <Settings className="size-4" />
                <span className="sr-only">{manageFieldsetLabel}</span>
              </button>
            </div>
          </div>,
        )
      }

      if (entityLayout.sections.length) {
        entityLayout.sections.forEach((section) => {
          const FieldsetIcon = section.fieldset?.icon
            ? FIELDSET_ICON_COMPONENTS[section.fieldset.icon]
            : null
          const sectionKey = `${entityLayout.entityId}:${section.fieldsetCode ?? 'default'}`
          const manageDisabled = !manageHref
          nodes.push(
            <div key={sectionKey} className="rounded-lg border bg-card p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {FieldsetIcon ? (
                    <FieldsetIcon className="size-5 text-muted-foreground" />
                  ) : null}
                  <div>
                    <div className="text-sm font-medium">{section.title}</div>
                    {section.description ? (
                      <div className="text-xs text-muted-foreground">
                        {section.description}
                      </div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => handleOpenFieldsetEditor(entityLayout.entityId, section.fieldsetCode, 'fieldset')}
                  disabled={manageDisabled}
                >
                  <Settings className="size-4" />
                  {manageFieldsetLabel}
                </button>
              </div>
              {section.groups.map((group) => {
                const groupKey = `${section.fieldsetCode ?? 'default'}:${group.code ?? 'default'}`
                return (
                  <div key={groupKey} className="space-y-2">
                    {group.label ? (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </div>
                        {group.hint ? (
                          <div className="text-xs text-muted-foreground">{group.hint}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {renderFields(group.fields)}
                  </div>
                )
              })}
              {!section.groups.length ? (
                <div className="text-xs text-muted-foreground">{emptyFieldsetMessage}</div>
              ) : null}
            </div>,
          )
        })
      } else {
        nodes.push(
          <div key={`custom-fields-empty-${entityLayout.entityId}`} className="rounded-lg border bg-card p-4">
            {customFieldsEmptyState}
          </div>,
        )
      }
    })

    return nodes
  }, [
    buildCustomFieldsManageHref,
    customFieldLayout,
    customFieldsEmptyState,
    defaultFieldsetLabel,
    emptyFieldsetMessage,
    fieldsetSelectorLabel,
    handleFieldsetSelectionChange,
    handleOpenFieldsetEditor,
    manageFieldsetLabel,
    renderFields,
  ])

  const fieldsetManagerDialog = (
    <Dialog open={fieldsetEditorTarget !== null} onOpenChange={(open) => { if (!open) setFieldsetEditorTarget(null) }}>
      <DialogContent
        className="max-w-5xl w-full"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleFieldsetDialogSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{fieldsetDialogTitle}</DialogTitle>
        </DialogHeader>
        {fieldsetEditorTarget ? (
          <FieldDefinitionsManager
            ref={fieldsetManagerRef}
            entityId={fieldsetEditorTarget.entityId}
            initialFieldset={fieldsetEditorTarget.fieldsetCode}
            fullEditorHref={fieldsetEditorFullHref ?? undefined}
            onSaved={refreshCustomFieldDefinitions}
            onClose={() => setFieldsetEditorTarget(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground px-4 text-center">
            {fieldsetDialogUnavailable}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )

  // If groups are provided, render the two-column grouped layout
  if (useGroupedLayout) {

    const col1: CrudFormGroup[] = []
    const col2: CrudFormGroup[] = []
    for (const g of resolvedGroupsForLayout) {
      if ((g.column ?? 1) === 2) col2.push(g)
      else col1.push(g)
    }

    const renderGroupedCards = (items: CrudFormGroup[]) => {
      const nodes: React.ReactNode[] = []
      for (const g of items) {
        const isCustomFieldsGroup = g.kind === 'customFields'
        if (isCustomFieldsGroup) {
          if (isLoadingCustomFields) {
            nodes.push(
              <div key={`${g.id}-loading`} className="rounded-lg border bg-card p-4">
                <DataLoader
                  isLoading
                  loadingMessage={resolvedCustomFieldsLoadingMessage}
                  spinnerSize="md"
                  className="min-h-[1px]"
                >
                  <div />
                </DataLoader>
              </div>,
            )
            continue
          }
          if (g.component) {
            nodes.push(
              <div key={`${g.id}-component`} className="rounded-lg border bg-card px-4 py-3">
                {g.component({ values, setValue, errors })}
              </div>,
            )
          }
          const renderedSections = renderCustomFieldsContent()
          if (renderedSections.length) nodes.push(...renderedSections)
          continue
        }

        const componentNode = g.component ? g.component({ values, setValue, errors }) : null
        if (g.bare) {
          if (componentNode) {
            nodes.push(<React.Fragment key={g.id}>{componentNode}</React.Fragment>)
          }
          continue
        }
        const groupFields = resolveGroupFields(g)
        nodes.push(
          <div key={g.id} className="rounded-lg border bg-card px-4 py-3 space-y-3">
            {g.title ? (
              <div className="text-sm font-medium">{g.title}</div>
            ) : null}
            {g.description ? <div className="text-xs text-muted-foreground">{g.description}</div> : null}
            {componentNode ? (
              <div>{componentNode}</div>
            ) : null}
            <DataLoader
              isLoading={false}
              loadingMessage={resolvedLoadingMessage}
              spinnerSize="md"
              className="min-h-[1px]"
            >
              {groupFields.length > 0 ? renderFields(groupFields) : <div className="min-h-[1px]" />}
            </DataLoader>
          </div>,
        )
      }
      return nodes
    }

    const col1Content = renderGroupedCards(col1)
    const col2Content = renderGroupedCards(col2)

    return (
      <div className="space-y-4" ref={rootRef}>
        {!embedded ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {backHref ? (
              <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
                ← {backLabel}
              </Link>
            ) : null}
            {title ? <div className="text-base font-medium">{title}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            {extraActions}
            {showDelete ? (
              <Button type="button" variant="outline" onClick={handleDelete} className="text-red-600 border-red-200 hover:bg-red-50 rounded">
                <Trash2 className="size-4 mr-2" />
                {deleteLabel}
              </Button>
            ) : null}
            {cancelHref ? (
              <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
                {cancelLabel}
              </Link>
            ) : null}
            <Button type="submit" form={formId} disabled={pending}>
              <Save className="size-4 mr-2" />
              {pending ? savingLabel : resolvedSubmitLabel}
            </Button>
          </div>
        </div>
        ) : null}
        {contentHeader}
        <DataLoader
          isLoading={isLoading}
          loadingMessage={resolvedLoadingMessage}
          spinnerSize="md"
            className="min-h-[400px]"
          >
            <form id={formId} onSubmit={handleSubmit} className={`space-y-4 ${dialogFormPadding}`}>
            {injectionSpotId ? (
              <InjectionSpot
                spotId={injectionSpotId}
                context={injectionContext}
                data={values}
                onDataChange={(newData) => setValues(newData as CrudFormValues<TValues>)}
                disabled={pending}
                widgetsOverride={stackedInjectionWidgets}
              />
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4">
              <div className="space-y-3">{col1Content}</div>
              <div className="space-y-3">{col2Content}</div>
            </div>
            {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
            <div className={`flex items-center ${embedded ? 'justify-end' : 'justify-between'} gap-2 ${dialogFooterClass}`}>
              {embedded ? null : <div />}
              <div className="flex items-center gap-2">
                {extraActions}
                {!embedded && showDelete ? (
                  <Button type="button" variant="outline" onClick={handleDelete} className="text-red-600 border-red-200 hover:bg-red-50 rounded">
                    <Trash2 className="size-4 mr-2" />
                    {deleteLabel}
                  </Button>
                ) : null}
                {!embedded && cancelHref ? (
                  <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
                    {cancelLabel}
                  </Link>
                ) : null}
                <Button type="submit" disabled={pending}>
                  <Save className="size-4 mr-2" />
                  {pending ? savingLabel : resolvedSubmitLabel}
                </Button>
              </div>
            </div>
          </form>
        </DataLoader>
        {fieldsetManagerDialog}
      </div>
    )
  }

  // Default single-card layout (compatible with previous API)
  return (
    <div className="space-y-4" ref={rootRef}>
      {!embedded ? (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {backHref ? (
            <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
              ← {backLabel}
            </Link>
          ) : null}
          {title ? <div className="text-base font-medium">{title}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {extraActions}
          {showDelete ? (
            <Button type="button" variant="outline" onClick={handleDelete} className="text-red-600 border-red-200 hover:bg-red-50 rounded">
              <Trash2 className="size-4 mr-2" />
              {deleteLabel}
            </Button>
          ) : null}
          {cancelHref ? (
            <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
              {cancelLabel}
            </Link>
          ) : null}
          <Button type="submit" form={formId} disabled={pending}>
            <Save className="size-4 mr-2" />
            {pending ? savingLabel : resolvedSubmitLabel}
          </Button>
        </div>
      </div>
      ) : null}
      {contentHeader}
      <DataLoader
        isLoading={isLoading}
        loadingMessage={resolvedLoadingMessage}
        spinnerSize="md"
        className="min-h-[400px]"
      >
        <div>
          <form
            id={formId}
            onSubmit={handleSubmit}
            className={`${embedded ? 'space-y-4' : 'rounded-lg border bg-card p-4 space-y-4'} ${dialogFormPadding}`}
          >
            {injectionSpotId ? (
              <InjectionSpot
                spotId={injectionSpotId}
                context={injectionContext}
                data={values}
                onDataChange={(newData) => setValues(newData as CrudFormValues<TValues>)}
                disabled={pending}
                widgetsOverride={stackedInjectionWidgets}
              />
            ) : null}
            <div className={grid}>
              {allFields.map((f) => {
                const layout = f.layout ?? 'full'
                const wrapperClassName = usesResponsiveLayout ? resolveLayoutClass(layout) : undefined
                return (
                  <FieldControl
                    key={f.id}
                    field={f}
                    value={values[f.id]}
                    error={errors[f.id]}
                    options={fieldOptionsById.get(f.id) || EMPTY_OPTIONS}
                    setValue={setValue}
                    values={values}
                    loadFieldOptions={loadFieldOptions}
                    autoFocus={Boolean(firstFieldId && f.id === firstFieldId)}
                    onSubmitRequest={requestSubmit}
                    wrapperClassName={wrapperClassName}
                    entityIdForField={primaryEntityId ?? undefined}
                    recordId={recordId}
                  />
                )
              })}
            </div>
            {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
            <div className={`flex items-center ${embedded ? 'justify-end' : 'justify-end'} gap-2 ${dialogFooterClass}`}>
              {extraActions}
              {!embedded && showDelete ? (
                <Button type="button" variant="outline" onClick={handleDelete} className="text-red-600 border-red-200 hover:bg-red-50">
                  <Trash2 className="size-4 mr-2" />
                  {deleteLabel}
                </Button>
              ) : null}
              {!embedded && cancelHref ? (
                <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
                  {cancelLabel}
                </Link>
              ) : null}
              <Button type="submit" disabled={pending}>
                <Save className="size-4 mr-2" />
                {pending ? savingLabel : resolvedSubmitLabel}
              </Button>
            </div>
          </form>
        </div>
      </DataLoader>
      {fieldsetManagerDialog}
    </div>
  )
}

function RelationSelect({
  value,
  onChange,
  options,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  options: CrudFieldOption[]
  placeholder?: string
  autoFocus?: boolean
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [query, options])

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        className="w-full h-9 rounded border px-2 text-sm"
        placeholder={placeholder || t('ui.forms.listbox.searchPlaceholder', 'Search...')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={autoFocus}
        data-crud-focus-target=""
      />
      <div className="max-h-40 overflow-auto rounded border">
        <button
          type="button"
          className="block w-full text-left px-2 py-1 text-sm hover:bg-muted"
          onClick={() => onChange('')}
        >
          —
        </button>
        {filtered.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`block w-full text-left px-2 py-1 text-sm hover:bg-muted ${
              value === opt.value ? 'bg-muted' : ''
            }`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
// Local-buffer text input to avoid focus loss when parent re-renders
function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  disabled,
  suggestions,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  onSubmit?: () => void
  disabled?: boolean
  suggestions?: string[]
}) {
  const [local, setLocal] = React.useState<string>(value)
  const isFocusedRef = React.useRef(false)
  const userTypingRef = React.useRef(false)
  const datalistId = React.useId()

  React.useEffect(() => {
    // Sync from props whenever the input is unfocused or the user hasn't typed yet.
    if (!isFocusedRef.current || !userTypingRef.current) {
      setLocal(value)
    }
  }, [value])

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const next = e.target.value
    userTypingRef.current = true
    setLocal(next)
    onChange(next)
  }, [disabled, onChange])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onChange(local)
      onSubmit?.()
    }
  }, [disabled, local, onChange, onSubmit])

  const handleFocus = React.useCallback(() => {
    isFocusedRef.current = true
  }, [])

  const handleBlur = React.useCallback(() => {
    isFocusedRef.current = false
    userTypingRef.current = false
    onChange(local)
  }, [local, onChange])

  return (
    <>
      <input
        type="text"
        className="w-full h-9 rounded border px-2 text-sm"
        placeholder={placeholder}
        value={local}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        spellCheck={false}
        autoFocus={autoFocus}
        data-crud-focus-target=""
        disabled={disabled}
        list={suggestions && suggestions.length > 0 ? datalistId : undefined}
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={datalistId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </>
  )
}

// Local-buffer number input to avoid focus loss when parent re-renders
function NumberInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
}: {
  value: number | string | null | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  autoFocus?: boolean
  onSubmit?: () => void
}) {
  const [local, setLocal] = React.useState<string>(value !== undefined && value !== null ? String(value) : '')
  const isFocusedRef = React.useRef(false)
  
  React.useEffect(() => {
    // Only sync from props when not focused to avoid caret jumps
    if (!isFocusedRef.current) {
      setLocal(value !== undefined && value !== null ? String(value) : '')
    }
  }, [value])
  
  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setLocal(next)
    const numValue = next === '' ? undefined : Number(next)
    onChange(numValue)
  }, [onChange])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const numValue = local === '' ? undefined : Number(local)
      onChange(numValue)
      onSubmit?.()
    }
  }, [local, onChange, onSubmit])
  
  const handleFocus = React.useCallback(() => {
    isFocusedRef.current = true
  }, [])
  
  const handleBlur = React.useCallback(() => {
    isFocusedRef.current = false
    const numValue = local === '' ? undefined : Number(local)
    onChange(numValue)
  }, [local, onChange])
  
  return (
    <input
      type="number"
      className="w-full h-9 rounded border px-2 text-sm"
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      autoFocus={autoFocus}
      data-crud-focus-target=""
    />
  )
}

// Local-buffer textarea to avoid form-wide re-renders while typing
function TextAreaInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [local, setLocal] = React.useState<string>(value)
  const isFocusedRef = React.useRef(false)

  React.useEffect(() => {
    if (!isFocusedRef.current) setLocal(value)
  }, [value])

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setLocal(next)
    onChange(next)
  }, [onChange])

  const handleFocus = React.useCallback(() => { isFocusedRef.current = true }, [])
  const handleBlur = React.useCallback(() => { isFocusedRef.current = false; onChange(local) }, [local, onChange])

  return (
    <textarea
      className="w-full rounded border px-2 py-2 min-h-[120px] text-sm"
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      autoFocus={autoFocus}
      data-crud-focus-target=""
    />
  )
}

// Markdown editor using @uiw/react-md-editor (client-only)
type MDProps = { value?: string; onChange: (md: string) => void }
const MDEditor = dynamic(async () => {
  const mod = await import('@uiw/react-md-editor')
  return mod.default
}, { ssr: false }) as React.ComponentType<UiWMDEditorProps>
const MarkdownEditor = React.memo(function MarkdownEditor({ value = '', onChange }: MDProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [local, setLocal] = React.useState<string>(value)
  const typingRef = React.useRef(false)

  React.useEffect(() => {
    if (!typingRef.current) setLocal(value)
  }, [value])

  const handleChange = React.useCallback((v?: string) => {
    typingRef.current = true
    setLocal(v ?? '')
  }, [])

  const commit = React.useCallback(() => {
    if (!typingRef.current) return
    typingRef.current = false
    onChange(local)
    requestAnimationFrame(() => {
      const ta = containerRef.current?.querySelector('textarea') as HTMLTextAreaElement | null
      ta?.focus()
    })
  }, [local, onChange])

  return (
    <div ref={containerRef} data-color-mode="light" className="w-full" onBlur={() => commit()}>
      <MDEditor
        value={local}
        height={220}
        onChange={handleChange}
        previewOptions={{ remarkPlugins: [remarkGfm] }}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

// HTML Rich Text editor (contentEditable) with shortcuts; returns HTML string
type HtmlRTProps = { value?: string; onChange: (html: string) => void }
const HtmlRichTextEditor = React.memo(function HtmlRichTextEditor({ value = '', onChange }: HtmlRTProps) {
  const t = useT()
  const boldLabel = t('ui.forms.richtext.bold')
  const italicLabel = t('ui.forms.richtext.italic')
  const underlineLabel = t('ui.forms.richtext.underline')
  const listLabel = t('ui.forms.richtext.list')
  const heading3Label = t('ui.forms.richtext.heading3')
  const linkLabel = t('ui.forms.richtext.link')
  const linkUrlPrompt = t('ui.forms.richtext.linkUrlPrompt')
  const ref = React.useRef<HTMLDivElement | null>(null)
  const applyingExternal = React.useRef(false)
  const typingRef = React.useRef(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const current = el.innerHTML
    if (!typingRef.current && current !== value) {
      applyingExternal.current = true
      el.innerHTML = value || ''
      requestAnimationFrame(() => { applyingExternal.current = false })
    }
  }, [value])

  const exec = (cmd: string, arg?: string) => {
    const el = ref.current
    if (!el) return
    el.focus()
    try {
      document.execCommand(cmd, false, arg)
    } catch {
      // ignore execCommand failures
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.metaKey || e.ctrlKey
    if (!isMod) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); exec('bold') }
    if (k === 'i') { e.preventDefault(); exec('italic') }
    if (k === 'u') { e.preventDefault(); exec('underline') }
  }

  return (
    <div className="w-full rounded border">
      <div className="flex items-center gap-1 px-2 py-1 border-b">
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>{boldLabel}</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>{italicLabel}</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>{underlineLabel}</button>
        <span className="mx-2 text-muted-foreground">|</span>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>• {listLabel}</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h3>')}>{heading3Label}</button>
        <button
          type="button"
          className="px-2 py-0.5 text-xs rounded hover:bg-muted"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt(linkUrlPrompt)?.trim()
            if (url) exec('createLink', url)
          }}
        >{linkLabel}</button>
      </div>
      <div
        ref={ref}
        className="w-full px-2 py-2 min-h-[160px] focus:outline-none prose prose-sm max-w-none"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onInput={() => { if (!applyingExternal.current) typingRef.current = true }}
        onBlur={() => {
          const el = ref.current
          if (!el) return
          typingRef.current = false
          onChange(el.innerHTML)
        }}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

// Very simple markdown editor with Bold/Italic/Underline + shortcuts.
type SimpleMDProps = { value?: string; onChange: (md: string) => void }
const SimpleMarkdownEditor = React.memo(function SimpleMarkdownEditor({ value = '', onChange }: SimpleMDProps) {
  const t = useT()
  const boldLabel = t('ui.forms.richtext.bold')
  const italicLabel = t('ui.forms.richtext.italic')
  const underlineLabel = t('ui.forms.richtext.underline')
  const markdownPlaceholder = t('ui.forms.richtext.placeholder')
  const sampleText = t('ui.forms.richtext.sampleText')
  const taRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [local, setLocal] = React.useState<string>(value)
  const typingRef = React.useRef(false)

  React.useEffect(() => {
    if (!typingRef.current) setLocal(value)
  }, [value])

  const wrap = (before: string, after: string = before) => {
    const el = taRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const sel = value.slice(start, end) || sampleText
    const next = value.slice(0, start) + before + sel + after + value.slice(end)
    onChange(next)
    queueMicrotask(() => {
      const caret = start + before.length + sel.length + after.length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.metaKey || e.ctrlKey
    if (!isMod) return
    const key = e.key.toLowerCase()
    if (key === 'b') { e.preventDefault(); wrap('**') }
    if (key === 'i') { e.preventDefault(); wrap('_') }
    if (key === 'u') { e.preventDefault(); wrap('__') }
  }

  return (
    <div className="w-full rounded border">
      <div className="flex items-center gap-1 px-2 py-1 border-b">
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}>{boldLabel}</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('_')}>{italicLabel}</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('__')}>{underlineLabel}</button>
      </div>
      <textarea
        ref={taRef}
        className="w-full min-h-[160px] resize-y px-2 py-2 font-mono text-sm outline-none"
        spellCheck={false}
        value={local}
        onChange={(e) => { typingRef.current = true; setLocal(e.target.value) }}
        onBlur={() => { if (typingRef.current) { typingRef.current = false; onChange(local) } }}
        onKeyDown={onKeyDown}
        placeholder={markdownPlaceholder}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

type FieldControlProps = {
  field: CrudField
  value: unknown
  error?: string
  options: CrudFieldOption[]
  setValue: (id: string, v: unknown) => void
  values: Record<string, unknown>
  loadFieldOptions: (field: CrudField, query?: string) => Promise<CrudFieldOption[]>
  autoFocus: boolean
  onSubmitRequest: () => void
  wrapperClassName?: string
  entityIdForField?: string
  recordId?: string
}

type ListboxMultiSelectProps = {
  options: CrudFieldOption[]
  placeholder?: string
  value: string[]
  onChange: (vals: string[]) => void
  autoFocus?: boolean
}

const ListboxMultiSelect = React.memo(function ListboxMultiSelect({
  options,
  placeholder,
  value,
  onChange,
  autoFocus,
}: ListboxMultiSelectProps) {
  const t = useT()
  const searchPlaceholder = placeholder || t('ui.forms.listbox.searchPlaceholder')
  const noMatchesLabel = t('ui.forms.listbox.noMatches')
  const [query, setQuery] = React.useState('')
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [options, query])
  const toggle = React.useCallback(
    (val: string) => {
      const set = new Set(value)
      if (set.has(val)) set.delete(val)
      else set.add(val)
      onChange(Array.from(set))
    },
    [value, onChange]
  )
  return (
    <div className="w-full">
      <input
        className="mb-2 w-full h-8 rounded border px-2 text-sm"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={autoFocus}
        data-crud-focus-target=""
      />
      <div className="rounded border max-h-48 overflow-auto divide-y">
        {filtered.map((opt) => {
          const isSel = value.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${isSel ? 'bg-muted' : ''}`}
            >
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" className="size-4" readOnly checked={isSel} />
                <span>{opt.label}</span>
              </span>
            </button>
          )
        })}
        {!filtered.length ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{noMatchesLabel}</div>
        ) : null}
      </div>
    </div>
  )
})

const FieldControl = React.memo(function FieldControlImpl({
  field,
  value,
  error,
  options,
  setValue,
  values,
  loadFieldOptions,
  autoFocus,
  onSubmitRequest,
  wrapperClassName,
  entityIdForField,
  recordId,
}: FieldControlProps) {
  const t = useT()
  const fieldSetValue = React.useCallback(
    (nextValue: unknown) => setValue(field.id, nextValue),
    [setValue, field.id]
  )
  const setFormValue = React.useCallback(
    (targetId: string, nextValue: unknown) => setValue(targetId, nextValue),
    [setValue],
  )
  const builtin = field.type === 'custom' ? null : field
  const hasLoader = typeof builtin?.loadOptions === 'function'
  const disabled = Boolean(field.disabled)
  const autoFocusField = autoFocus && !disabled

  React.useEffect(() => {
    if (!hasLoader || field.type === 'custom') return
    loadFieldOptions(field).catch(() => {})
  }, [field, hasLoader, loadFieldOptions])

  const placeholder = builtin?.placeholder
  const rootClassName = wrapperClassName ? `space-y-1 ${wrapperClassName}` : 'space-y-1'

  return (
    <div className={rootClassName} data-crud-field-id={field.id}>
      {field.type !== 'checkbox' ? (
        <label className="block text-sm font-medium">
          {field.label}
          {field.required ? <span className="text-red-600"> *</span> : null}
        </label>
      ) : null}
      {field.type === 'text' && (
        <TextInput
          value={value == null ? '' : String(value)}
          placeholder={placeholder}
          onChange={(next) => fieldSetValue(next)}
          autoFocus={autoFocusField}
          onSubmit={onSubmitRequest}
          disabled={disabled}
          suggestions={field.type === 'text' ? field.suggestions : undefined}
        />
      )}
      {field.type === 'number' && (
        <NumberInput
          value={typeof value === 'number' || typeof value === 'string' ? value : null}
          placeholder={placeholder}
          onChange={fieldSetValue}
          autoFocus={autoFocusField}
          onSubmit={onSubmitRequest}
        />
      )}
      {field.type === 'date' && (
        <input
          type="date"
          className="w-full h-9 rounded border px-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setValue(field.id, e.target.value || undefined)}
          autoFocus={autoFocusField}
          data-crud-focus-target=""
          disabled={disabled}
        />
      )}
      {field.type === 'textarea' && (
        <TextAreaInput
          value={value == null ? '' : String(value)}
          placeholder={placeholder}
          onChange={(next) => fieldSetValue(next)}
          autoFocus={autoFocusField}
        />
      )}
      {field.type === 'richtext' && builtin?.editor === 'simple' && (
        <SimpleMarkdownEditor value={String(value ?? '')} onChange={fieldSetValue} />
      )}
      {field.type === 'richtext' && builtin?.editor === 'html' && (
        <HtmlRichTextEditor value={String(value ?? '')} onChange={fieldSetValue} />
      )}
      {field.type === 'richtext' && (!builtin?.editor || (builtin.editor !== 'simple' && builtin.editor !== 'html')) && (
        <MarkdownEditor value={String(value ?? '')} onChange={fieldSetValue} />
      )}
      {field.type === 'tags' && (
        <TagsInput
          value={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []}
          onChange={(next) => fieldSetValue(next)}
          placeholder={placeholder}
          autoFocus={autoFocusField}
          suggestions={options.map((opt) => opt.label)}
          loadSuggestions={
            typeof builtin?.loadOptions === 'function'
              ? async (query?: string) => {
                  const opts = await loadFieldOptions(field, query)
                  return opts.map((opt) => opt.label)
                }
              : undefined
          }
        />
      )}
      {field.type === 'combobox' && (
        <ComboboxInput
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={(next) => fieldSetValue(next)}
          placeholder={placeholder}
          autoFocus={autoFocusField}
          suggestions={
            builtin?.suggestions
              ? builtin.suggestions
              : options.map((opt) => ({ value: opt.value, label: opt.label }))
          }
          loadSuggestions={
            typeof builtin?.loadOptions === 'function'
              ? async (query?: string) => {
                  const opts = await loadFieldOptions(field, query)
                  return opts.map((opt) => ({ value: opt.value, label: opt.label }))
                }
              : undefined
          }
          allowCustomValues={builtin?.allowCustomValues ?? true}
          disabled={disabled}
        />
      )}
      {field.type === 'checkbox' && (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={value === true}
            onChange={(e) => setValue(field.id, e.target.checked)}
            data-crud-focus-target=""
            disabled={disabled}
          />
          <span className="text-sm">{field.label}</span>
        </label>
      )}
      {field.type === 'select' && !builtin?.multiple && (
        <select
          className="w-full h-9 rounded border px-2 text-sm"
          value={
            Array.isArray(value)
              ? String(value[0] ?? '')
              : value == null
                ? ''
                : String(value)
          }
          onChange={(e) => setValue(field.id, e.target.value || undefined)}
          data-crud-focus-target=""
          disabled={disabled}
        >
          <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
      {field.type === 'select' && builtin?.multiple && builtin.listbox === true && (
        <ListboxMultiSelect
          options={options}
          placeholder={placeholder}
          value={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []}
          onChange={(vals) => setValue(field.id, vals)}
          autoFocus={autoFocusField}
        />
      )}
      {field.type === 'select' && builtin?.multiple && builtin.listbox !== true && (
        <div className="flex flex-wrap gap-3">
          {options.map((opt) => {
            const arr = Array.isArray(value)
              ? value.filter((item): item is string => typeof item === 'string')
              : []
            const checked = arr.includes(opt.value)
            return (
              <label key={opt.value} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(arr)
                    if (e.target.checked) {
                      next.add(opt.value)
                    } else {
                      next.delete(opt.value)
                    }
                    setValue(field.id, Array.from(next))
                  }}
                  disabled={disabled}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}
      {field.type === 'relation' && (
        <RelationSelect
          options={options}
          placeholder={placeholder}
          value={
            Array.isArray(value)
              ? String(value[0] ?? '')
              : value == null
                ? ''
                : String(value)
          }
          onChange={(selected) => setValue(field.id, selected)}
          autoFocus={autoFocusField}
        />
      )}
      {field.type === 'custom' && (
        <>
          {field.component({
            id: field.id,
            value,
            error,
            setValue: fieldSetValue,
            setFormValue,
            values,
            entityId: entityIdForField,
            recordId,
            autoFocus,
            disabled,
          })}
        </>
      )}
      {field.description ? (
        <div className="text-xs text-muted-foreground">{field.description}</div>
      ) : null}
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  )
},
(prev, next) =>
  prev.field.id === next.field.id &&
  prev.field.type === next.field.type &&
  prev.field.label === next.field.label &&
  prev.field.required === next.field.required &&
  prev.value === next.value &&
  prev.error === next.error &&
  prev.options === next.options &&
  prev.loadFieldOptions === next.loadFieldOptions &&
  prev.autoFocus === next.autoFocus &&
  prev.onSubmitRequest === next.onSubmitRequest &&
  prev.wrapperClassName === next.wrapperClassName &&
  prev.entityIdForField === next.entityIdForField &&
  prev.recordId === next.recordId &&
  (prev.field.type !== 'custom' || prev.values === next.values)
)
