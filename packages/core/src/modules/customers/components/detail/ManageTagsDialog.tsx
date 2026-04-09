'use client'

import * as React from 'react'
import {
  CalendarDays,
  Flame,
  GripVertical,
  Hash,
  Info,
  Radio,
  RefreshCw,
  Tag,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { invalidateDictionaryEntries } from '@open-mercato/core/modules/dictionaries/components/hooks/useDictionaryEntries'
import { ICON_SUGGESTIONS, renderDictionaryIcon } from '@open-mercato/core/modules/customers/lib/dictionaries'

type DictionaryInfo = {
  id: string
  key: string
  label: string
  entryCount: number
}

type TagEntryDraft = {
  localId: string
  id: string | null
  value: string
  label: string
  color: string
  icon: string
  manualValue: boolean
  deleted: boolean
}

const TAG_CATEGORY_KEYS = [
  'customers.status',
  'customers.lifecycle_stage',
  'customers.source',
  'customers.renewal_quarter',
  'customers.temperature',
  'customers.custom_tags',
] as const

const CATEGORY_META: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>
    shortLabel: string
    description: string
    badges?: string[]
    noteTitle: string
    noteDescription: string
  }
> = {
  'customers.status': {
    icon: Tag,
    shortLabel: 'Status',
    description: 'Single-select values visible on the hero area of person, company, and deal cards.',
    badges: ['system', 'required'],
    noteTitle: 'System category',
    noteDescription: 'Status is required on customer cards. Existing rows can be edited, but this category should remain available tenant-wide.',
  },
  'customers.lifecycle_stage': {
    icon: RefreshCw,
    shortLabel: 'Lifecycle',
    description: 'Pipeline-aligned lifecycle values shared across CRM detail pages.',
    badges: ['system'],
    noteTitle: 'Shared lifecycle values',
    noteDescription: 'Use lifecycle stages to keep person and company headers visually consistent across CRM detail views.',
  },
  'customers.source': {
    icon: Radio,
    shortLabel: 'Source',
    description: 'Acquisition source labels used in Zone 1 forms and CRM summary badges.',
    badges: ['system'],
    noteTitle: 'Source dictionary',
    noteDescription: 'These values are reused by customer forms and reporting filters.',
  },
  'customers.renewal_quarter': {
    icon: CalendarDays,
    shortLabel: 'Renewal',
    description: 'Quarter-based renewal helpers displayed in CRM detail cards and pipeline summaries.',
    noteTitle: 'Renewal planning',
    noteDescription: 'Keep quarter naming consistent so renewal filters remain readable across the CRM.',
  },
  'customers.temperature': {
    icon: Flame,
    shortLabel: 'Temperature',
    description: 'Hot, warm, and cold style indicators used in the person and company header badges.',
    noteTitle: 'Sales temperature',
    noteDescription: 'Temperature values affect the visual emphasis of CRM header badges and deal context chips.',
  },
  'customers.custom_tags': {
    icon: Hash,
    shortLabel: 'Custom',
    description: 'Optional tenant-specific tags for people, companies, and linked deals.',
    noteTitle: 'Custom tags',
    noteDescription: 'Add lightweight CRM-specific labels here when the built-in status dictionaries are not enough.',
  },
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `draft-${Math.random().toString(36).slice(2)}`
}

function normalizeColor(value: string | null | undefined): string {
  if (typeof value !== 'string') return '#D1D5DB'
  const trimmed = value.trim()
  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) {
    return `#${trimmed.slice(1).toLowerCase()}`
  }
  return '#D1D5DB'
}

function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sanitizeIcon(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function makeDraftEntry(entry: Record<string, unknown>): TagEntryDraft | null {
  const id = typeof entry.id === 'string' ? entry.id : null
  const value = typeof entry.value === 'string' ? entry.value.trim() : ''
  if (!value.length) return null
  return {
    localId: id ?? createLocalId(),
    id,
    value,
    label:
      typeof entry.label === 'string' && entry.label.trim().length
        ? entry.label.trim()
        : value,
    color: normalizeColor(typeof entry.color === 'string' ? entry.color : null),
    icon: sanitizeIcon(typeof entry.icon === 'string' ? entry.icon : null),
    manualValue: true,
    deleted: false,
  }
}

function cloneDrafts(entries: TagEntryDraft[]): TagEntryDraft[] {
  return entries.map((entry) => ({ ...entry }))
}

function serializeEntries(entries: TagEntryDraft[]): string {
  return JSON.stringify(
    entries
      .filter((entry) => !entry.deleted)
      .map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
      })),
  )
}

interface ManageTagsDialogProps {
  open: boolean
  onClose: () => void
}

export function ManageTagsDialog({ open, onClose }: ManageTagsDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [dictionaries, setDictionaries] = React.useState<DictionaryInfo[]>([])
  const [activeTab, setActiveTab] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState('')
  const [draftsByKey, setDraftsByKey] = React.useState<Record<string, TagEntryDraft[]>>({})
  const [originalByKey, setOriginalByKey] = React.useState<Record<string, TagEntryDraft[]>>({})

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        '/api/dictionaries?pageSize=100',
      )
      const items = Array.isArray(data?.items) ? data.items : []
      const matched: DictionaryInfo[] = []
      const loadedDrafts: Record<string, TagEntryDraft[]> = {}

      for (const key of TAG_CATEGORY_KEYS) {
        const dictionary = items.find(
          (item) => typeof item.key === 'string' && item.key === key && typeof item.id === 'string',
        )
        if (!dictionary || typeof dictionary.id !== 'string') continue

        const entriesPayload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/dictionaries/${dictionary.id}/entries`,
        )
        const entries = Array.isArray(entriesPayload?.items)
          ? entriesPayload.items.map(makeDraftEntry).filter((entry): entry is TagEntryDraft => entry !== null)
          : []

        matched.push({
          id: dictionary.id,
          key,
          label:
            typeof dictionary.name === 'string' && dictionary.name.trim().length
              ? dictionary.name.trim()
              : CATEGORY_META[key]?.shortLabel ?? key,
          entryCount: entries.length,
        })
        loadedDrafts[key] = entries
      }

      setDictionaries(matched)
      setDraftsByKey(
        Object.fromEntries(Object.entries(loadedDrafts).map(([key, entries]) => [key, cloneDrafts(entries)])),
      )
      setOriginalByKey(
        Object.fromEntries(Object.entries(loadedDrafts).map(([key, entries]) => [key, cloneDrafts(entries)])),
      )
      setActiveTab((current) => {
        if (current && matched.some((dictionary) => dictionary.key === current)) return current
        return matched[0]?.key ?? null
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.tags.manage.loadError', 'Failed to load tag dictionaries.')
      flash(message, 'error')
      setDictionaries([])
      setDraftsByKey({})
      setOriginalByKey({})
      setActiveTab(null)
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    setSearchValue('')
    loadData().catch(() => {})
  }, [loadData, open])

  const activeDictionary = React.useMemo(
    () => dictionaries.find((dictionary) => dictionary.key === activeTab) ?? null,
    [activeTab, dictionaries],
  )

  const activeMeta = activeTab ? CATEGORY_META[activeTab] : null
  const activeEntries = activeTab ? draftsByKey[activeTab] ?? [] : []
  const visibleEntries = React.useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    return activeEntries.filter((entry) => {
      if (entry.deleted) return false
      if (!query) return true
      return entry.label.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query)
    })
  }, [activeEntries, searchValue])

  const hasChanges = React.useMemo(
    () =>
      dictionaries.some((dictionary) => {
        const original = originalByKey[dictionary.key] ?? []
        const current = draftsByKey[dictionary.key] ?? []
        return serializeEntries(original) !== serializeEntries(current)
      }),
    [dictionaries, draftsByKey, originalByKey],
  )

  const updateDraftEntry = React.useCallback(
    (
      dictionaryKey: string,
      localId: string,
      updater: (entry: TagEntryDraft) => TagEntryDraft,
    ) => {
      setDraftsByKey((current) => ({
        ...current,
        [dictionaryKey]: (current[dictionaryKey] ?? []).map((entry) =>
          entry.localId === localId ? updater(entry) : entry,
        ),
      }))
    },
    [],
  )

  const handleAddEntry = React.useCallback(() => {
    if (!activeTab) return
    setDraftsByKey((current) => ({
      ...current,
      [activeTab]: [
        ...(current[activeTab] ?? []),
        {
          localId: createLocalId(),
          id: null,
          value: '',
          label: '',
          color: '#D1D5DB',
          icon: '',
          manualValue: false,
          deleted: false,
        },
      ],
    }))
  }, [activeTab])

  const handleDeleteEntry = React.useCallback((dictionaryKey: string, localId: string) => {
    setDraftsByKey((current) => {
      const nextEntries = (current[dictionaryKey] ?? [])
        .map((entry) => {
          if (entry.localId !== localId) return entry
          if (!entry.id) return null
          return { ...entry, deleted: true }
        })
        .filter((entry): entry is TagEntryDraft => entry !== null)
      return {
        ...current,
        [dictionaryKey]: nextEntries,
      }
    })
  }, [])

  const handleSave = React.useCallback(async () => {
    if (saving) return

    for (const dictionary of dictionaries) {
      const entries = draftsByKey[dictionary.key] ?? []
      for (const entry of entries) {
        if (entry.deleted) continue
        const nextLabel = entry.label.trim()
        const nextValue = entry.value.trim()
        if (!nextLabel || !nextValue) {
          flash(
            t('customers.tags.manage.validation.required', 'Each entry must have both a label and a slug before saving.'),
            'error',
          )
          return
        }
      }
    }

    setSaving(true)
    try {
      for (const dictionary of dictionaries) {
        const currentEntries = draftsByKey[dictionary.key] ?? []
        const originalEntries = originalByKey[dictionary.key] ?? []
        const originalById = new Map(
          originalEntries.filter((entry) => entry.id).map((entry) => [entry.id as string, entry]),
        )

        for (const entry of currentEntries) {
          if (entry.deleted) {
            if (entry.id) {
              await apiCallOrThrow(`/api/dictionaries/${dictionary.id}/entries/${entry.id}`, {
                method: 'DELETE',
              })
            }
            continue
          }

          const payload = {
            value: entry.value.trim(),
            label: entry.label.trim(),
            color: normalizeColor(entry.color),
            icon: sanitizeIcon(entry.icon) || undefined,
          }

          if (!entry.id) {
            await apiCallOrThrow(`/api/dictionaries/${dictionary.id}/entries`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            continue
          }

          const originalEntry = originalById.get(entry.id)
          if (
            originalEntry &&
            originalEntry.value === payload.value &&
            originalEntry.label === payload.label &&
            normalizeColor(originalEntry.color) === payload.color &&
            sanitizeIcon(originalEntry.icon) === sanitizeIcon(payload.icon)
          ) {
            continue
          }

          await apiCallOrThrow(`/api/dictionaries/${dictionary.id}/entries/${entry.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        }

        await invalidateDictionaryEntries(queryClient, dictionary.id)
      }

      flash(t('customers.tags.manage.saveSuccess', 'Tag dictionaries updated.'), 'success')
      await loadData()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.tags.manage.saveError', 'Failed to save tag dictionaries.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [dictionaries, draftsByKey, loadData, originalByKey, queryClient, saving, t])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-[760px] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-[28px] font-semibold leading-none">
            {t('customers.tags.manage.title', 'Manage tags')}
          </DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('customers.tags.manage.subtitle', 'Tag dictionaries for the entire tenant')}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            {t('customers.tags.manage.loading', 'Loading...')}
          </div>
        ) : (
          <>
            <div className="border-b border-border/70 px-6">
              <div className="flex flex-wrap items-center gap-4">
                {dictionaries.map((dictionary) => {
                  const meta = CATEGORY_META[dictionary.key]
                  const Icon = meta?.icon ?? Tag
                  const isActive = dictionary.key === activeTab
                  return (
                    <button
                      key={dictionary.key}
                      type="button"
                      onClick={() => setActiveTab(dictionary.key)}
                      className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm transition-colors ${
                        isActive
                          ? 'border-foreground font-semibold text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="size-3.5" />
                      <span>{meta?.shortLabel ?? dictionary.label}</span>
                      <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                        {dictionary.entryCount}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-5 px-6 py-5">
              {activeDictionary && activeMeta ? (
                <>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">
                          {activeMeta.shortLabel.toUpperCase()}
                        </h3>
                        {(activeMeta.badges ?? []).map((badge) => (
                          <Badge key={badge} variant="outline" className="rounded-[6px] px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t(`customers.tags.manage.description.${activeDictionary.key}`, activeMeta.description)}</span>
                      </div>
                    </div>
                    <div className="w-full lg:max-w-[220px]">
                      <Input
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder={t('customers.tags.manage.search', 'Search values...')}
                        className="h-10 rounded-[10px] border-border/80 shadow-none"
                      />
                    </div>
                  </div>

                  <div className="rounded-[14px] border border-border/70 bg-background">
                    <div className="grid grid-cols-[32px_minmax(0,1.6fr)_minmax(0,1fr)_130px_110px_40px] gap-3 border-b border-border/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <span />
                      <span>{t('customers.tags.manage.columns.label', 'Label')}</span>
                      <span>{t('customers.tags.manage.columns.slug', 'Slug')}</span>
                      <span>{t('customers.tags.manage.columns.color', 'Color')}</span>
                      <span>{t('customers.tags.manage.columns.icon', 'Icon')}</span>
                      <span />
                    </div>

                    <div className="space-y-0">
                      {visibleEntries.map((entry, index) => (
                        <div
                          key={entry.localId}
                          className={`grid grid-cols-[32px_minmax(0,1.6fr)_minmax(0,1fr)_130px_110px_40px] gap-3 px-4 py-3 ${
                            index < visibleEntries.length - 1 ? 'border-b border-border/60' : ''
                          }`}
                        >
                          <div className="flex items-center justify-center text-muted-foreground">
                            <GripVertical className="size-4" />
                          </div>
                          <div className="space-y-1">
                            <Input
                              value={entry.label}
                              onChange={(event) => {
                                const nextLabel = event.target.value
                                updateDraftEntry(activeDictionary.key, entry.localId, (current) => ({
                                  ...current,
                                  label: nextLabel,
                                  value: current.manualValue ? current.value : slugifyLabel(nextLabel),
                                }))
                              }}
                              className="h-9 rounded-[10px] border-border/80 shadow-none"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              {entry.id
                                ? t('customers.tags.manage.entrySaved', 'Existing dictionary value')
                                : t('customers.tags.manage.entryNew', 'New dictionary value')}
                            </p>
                          </div>
                          <div>
                            <Input
                              value={entry.value}
                              onChange={(event) => {
                                const nextValue = slugifyLabel(event.target.value)
                                updateDraftEntry(activeDictionary.key, entry.localId, (current) => ({
                                  ...current,
                                  value: nextValue,
                                  manualValue: true,
                                }))
                              }}
                              className="h-9 rounded-[10px] border-border/80 bg-muted/40 shadow-none"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={normalizeColor(entry.color)}
                              onChange={(event) => {
                                const nextColor = normalizeColor(event.target.value)
                                updateDraftEntry(activeDictionary.key, entry.localId, (current) => ({
                                  ...current,
                                  color: nextColor,
                                }))
                              }}
                              className="h-9 w-10 cursor-pointer rounded-[10px] border border-border/80 bg-background"
                              aria-label={t('customers.tags.manage.columns.color', 'Color')}
                            />
                            <Input
                              value={normalizeColor(entry.color)}
                              onChange={(event) => {
                                const nextColor = normalizeColor(event.target.value)
                                updateDraftEntry(activeDictionary.key, entry.localId, (current) => ({
                                  ...current,
                                  color: nextColor,
                                }))
                              }}
                              className="h-9 rounded-[10px] border-border/80 px-2 text-xs uppercase shadow-none"
                            />
                          </div>
                          <div>
                            <div className="relative">
                              <select
                                value={entry.icon}
                                onChange={(event) => {
                                  updateDraftEntry(activeDictionary.key, entry.localId, (current) => ({
                                    ...current,
                                    icon: event.target.value,
                                  }))
                                }}
                                className="h-9 w-full rounded-[10px] border border-border/80 bg-background pl-9 pr-2 text-sm shadow-none focus:outline-none focus:ring-2 focus:ring-ring/30"
                              >
                                <option value="">{t('customers.tags.manage.icon.none', 'No icon')}</option>
                                {ICON_SUGGESTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                {entry.icon ? renderDictionaryIcon(entry.icon, 'size-4') : <Tag className="size-4" />}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteEntry(activeDictionary.key, entry.localId)}
                              aria-label={t('customers.tags.manage.delete', 'Delete')}
                            >
                              <Trash2 className="size-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                      ))}

                      {visibleEntries.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                          {t('customers.tags.manage.noMatches', 'No entries match the current search.')}
                        </div>
                      ) : null}
                    </div>

                    <div className="border-t border-dashed border-border/70 px-4 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleAddEntry}
                        className="w-full rounded-[10px] border border-dashed border-border/70 text-sm text-muted-foreground hover:text-foreground"
                      >
                        + {t('customers.tags.manage.addValue', 'Add new value')}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-[12px] bg-muted/30 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {t(`customers.tags.manage.noteTitle.${activeDictionary.key}`, activeMeta.noteTitle)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t(`customers.tags.manage.noteDescription.${activeDictionary.key}`, activeMeta.noteDescription)}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t('customers.tags.manage.noDictionaries', 'No tag categories found.')}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border/70 px-6 py-4 sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {t('customers.tags.manage.tenantNotice', 'Changes apply to the entire tenant and are visible immediately.')}
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  {t('customers.tags.manage.close', 'Cancel')}
                </Button>
                <Button type="button" onClick={() => { void handleSave() }} disabled={saving || !hasChanges}>
                  {saving
                    ? t('customers.tags.manage.saving', 'Saving...')
                    : t('customers.tags.manage.save', 'Save changes')}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
