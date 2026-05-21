'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { X } from '../lucide-icons'
import { HiddenFieldsPanel } from '../logic/HiddenFieldsPanel'
import { VariablesPanel } from '../logic/VariablesPanel'
import { RolesEditor } from './RolesEditor'
import type { FormSchema, HiddenFieldEntry, VariableEntry } from '../schema-helpers'

export type InputParametersTabProps = {
  formId: string
  formKey: string
  name: string
  description: string
  supportedLocales: string[]
  defaultLocale: string
  defaultActorRole: string
  declaredRoles: string[]
  guestEnabled: boolean
  density: 'default' | 'compact' | 'spacious'
  labelPosition: 'top' | 'left'
  pageMode: 'stacked' | 'paginated'
  showProgress: boolean
  hiddenFields: HiddenFieldEntry[]
  variables: VariableEntry[]
  schema: FormSchema
  /** Number of derived pages — used to gate the progress switch (Decision 20c). */
  pagesCount: number
  onNameChange: (next: string) => void
  onDescriptionChange: (next: string) => void
  onToggleGuest: (enabled: boolean) => void
  onAddRole: (role: string) => void
  onRenameRole: (oldRole: string, newRole: string) => void
  onRemoveRole: (role: string) => void
  onDefaultActorRoleChange: (next: string) => void
  onDensityChange: (next: 'default' | 'compact' | 'spacious') => void
  onLabelPositionChange: (next: 'top' | 'left') => void
  onPageModeChange: (next: 'stacked' | 'paginated') => void
  onShowProgressChange: (next: boolean) => void
  onHiddenFieldsChange: (entries: HiddenFieldEntry[]) => void
  onVariablesChange: (entries: VariableEntry[]) => void
  onAddLocale: (locale: string) => void
  onRemoveLocale: (locale: string) => void
  onDefaultLocaleChange: (locale: string) => void
}

/** Mirrors `localeSchema` (validators.ts): BCP-47 shape like `en` or `en-US`. */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/

function isValidLocale(value: string): boolean {
  return value.length >= 2 && value.length <= 10 && LOCALE_PATTERN.test(value)
}

export function InputParametersTab(props: InputParametersTabProps) {
  const t = useT()
  const {
    formId,
    formKey,
    name,
    description,
    supportedLocales,
    defaultLocale,
    defaultActorRole,
    declaredRoles,
    guestEnabled,
    density,
    labelPosition,
    pageMode,
    showProgress,
    pagesCount,
    hiddenFields,
    variables,
    schema,
    onNameChange,
    onDescriptionChange,
    onToggleGuest,
    onAddRole,
    onRenameRole,
    onRemoveRole,
    onDefaultActorRoleChange,
    onDensityChange,
    onLabelPositionChange,
    onPageModeChange,
    onShowProgressChange,
    onHiddenFieldsChange,
    onVariablesChange,
    onAddLocale,
    onRemoveLocale,
    onDefaultLocaleChange,
  } = props

  const [localeDraft, setLocaleDraft] = React.useState('')
  const localeList = supportedLocales.length === 0 ? ['en'] : supportedLocales
  const trimmedDraft = localeDraft.trim()
  const canAddLocale =
    isValidLocale(trimmedDraft) && !localeList.includes(trimmedDraft)
  const submitLocale = React.useCallback(() => {
    if (!canAddLocale) return
    onAddLocale(trimmedDraft)
    setLocaleDraft('')
  }, [canAddLocale, onAddLocale, trimmedDraft])

  const roleOptions = React.useMemo(() => {
    const set = new Set<string>(['admin'])
    for (const role of declaredRoles) set.add(role)
    if (defaultActorRole) set.add(defaultActorRole)
    return Array.from(set)
  }, [declaredRoles, defaultActorRole])

  // Decision 20c — progress is meaningful only when paginated AND >= 2 pages.
  const progressEnabled = pageMode === 'paginated' && pagesCount >= 2

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-key"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.key.label')}
        </label>
        <Input
          id="forms-studio-form-key"
          readOnly
          value={formKey}
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-name"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.name.label')}
        </label>
        <Input
          id="forms-studio-form-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-description"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.description.label')}
        </label>
        <Textarea
          id="forms-studio-form-description"
          rows={2}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <span className="block text-sm font-medium text-foreground">
          {t('forms.studio.parameters.locales.label')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {localeList.map((locale) => {
            const isDefault = locale === defaultLocale
            const canRemove = !isDefault && localeList.length > 1
            return (
              <span
                key={locale}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 py-0.5 pl-2 pr-1 text-xs"
              >
                <span className="font-mono">{locale}</span>
                {isDefault ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('forms.studio.parameters.locales.defaultBadge')}
                  </span>
                ) : null}
                {canRemove ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-5"
                    aria-label={t('forms.studio.parameters.locales.remove', { locale })}
                    onClick={() => onRemoveLocale(locale)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </IconButton>
                ) : null}
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={localeDraft}
            placeholder={t('forms.studio.parameters.locales.add_placeholder')}
            aria-label={t('forms.studio.parameters.locales.add')}
            className="h-8 font-mono text-xs"
            onChange={(event) => setLocaleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitLocale()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAddLocale}
            onClick={submitLocale}
          >
            {t('forms.studio.parameters.locales.add')}
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-default-locale"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.locales.default')}
        </label>
        <Select value={defaultLocale} onValueChange={onDefaultLocaleChange}>
          <SelectTrigger id="forms-studio-form-default-locale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {localeList.map((locale) => (
              <SelectItem key={locale} value={locale}>
                {locale}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <span className="block text-sm font-medium text-foreground">
          {t('forms.studio.parameters.roles.label')}
        </span>
        <p className="text-xs text-muted-foreground">
          {t('forms.studio.parameters.roles.helper')}
        </p>
        <RolesEditor
          roles={roleOptions}
          guestEnabled={guestEnabled}
          onToggleGuest={onToggleGuest}
          onAdd={onAddRole}
          onRename={onRenameRole}
          onRemove={onRemoveRole}
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-default-role"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.defaultActorRole.label')}
        </label>
        <Select
          value={defaultActorRole || 'admin'}
          onValueChange={onDefaultActorRoleChange}
        >
          <SelectTrigger id="forms-studio-form-default-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-density"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.density.label')}
        </label>
        <Select
          value={density}
          onValueChange={(next) => onDensityChange(next as 'default' | 'compact' | 'spacious')}
        >
          <SelectTrigger id="forms-studio-form-density">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t('forms.studio.parameters.density.default')}</SelectItem>
            <SelectItem value="compact">{t('forms.studio.parameters.density.compact')}</SelectItem>
            <SelectItem value="spacious">{t('forms.studio.parameters.density.spacious')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-label-position"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.labelPosition.label')}
        </label>
        <Select
          value={labelPosition}
          onValueChange={(next) => onLabelPositionChange(next as 'top' | 'left')}
        >
          <SelectTrigger id="forms-studio-form-label-position">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="top">{t('forms.studio.parameters.labelPosition.top')}</SelectItem>
            <SelectItem value="left">{t('forms.studio.parameters.labelPosition.left')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-form-page-mode"
          className="block text-sm font-medium text-foreground"
        >
          {t('forms.studio.parameters.pageMode.label')}
        </label>
        <Select
          value={pageMode}
          onValueChange={(next) => onPageModeChange(next as 'stacked' | 'paginated')}
        >
          <SelectTrigger id="forms-studio-form-page-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stacked">{t('forms.studio.parameters.pageMode.stacked')}</SelectItem>
            <SelectItem value="paginated">{t('forms.studio.parameters.pageMode.paginated')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-foreground">
            {t('forms.studio.parameters.progress.label')}
          </span>
          <Switch
            checked={progressEnabled && showProgress}
            disabled={!progressEnabled}
            onCheckedChange={(value) => onShowProgressChange(Boolean(value))}
          />
        </label>
        {!progressEnabled ? (
          <p className="text-xs text-muted-foreground">
            {t('forms.studio.parameters.progress.helper.disabled')}
          </p>
        ) : null}
      </div>
      <div className="border-t border-border pt-3">
        <HiddenFieldsPanel
          formId={formId}
          entries={hiddenFields}
          onChange={onHiddenFieldsChange}
        />
      </div>
      <div className="border-t border-border pt-3">
        <VariablesPanel
          schema={schema}
          entries={variables}
          onChange={onVariablesChange}
        />
      </div>
    </div>
  )
}
