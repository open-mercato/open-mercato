'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { HiddenFieldsPanel } from '../logic/HiddenFieldsPanel'
import { VariablesPanel } from '../logic/VariablesPanel'
import type { FormSchema, HiddenFieldEntry, VariableEntry } from '../schema-helpers'

export type InputParametersTabProps = {
  formId: string
  formKey: string
  name: string
  description: string
  supportedLocales: string[]
  defaultActorRole: string
  declaredRoles: string[]
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
  onDefaultActorRoleChange: (next: string) => void
  onDensityChange: (next: 'default' | 'compact' | 'spacious') => void
  onLabelPositionChange: (next: 'top' | 'left') => void
  onPageModeChange: (next: 'stacked' | 'paginated') => void
  onShowProgressChange: (next: boolean) => void
  onHiddenFieldsChange: (entries: HiddenFieldEntry[]) => void
  onVariablesChange: (entries: VariableEntry[]) => void
}

export function InputParametersTab(props: InputParametersTabProps) {
  const t = useT()
  const {
    formId,
    formKey,
    name,
    description,
    supportedLocales,
    defaultActorRole,
    declaredRoles,
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
    onDefaultActorRoleChange,
    onDensityChange,
    onLabelPositionChange,
    onPageModeChange,
    onShowProgressChange,
    onHiddenFieldsChange,
    onVariablesChange,
  } = props

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
      <div className="space-y-1">
        <span className="block text-sm font-medium text-foreground">
          {t('forms.studio.parameters.locales.label')}
        </span>
        <div className="flex flex-wrap gap-1">
          {supportedLocales.length === 0 ? (
            <Tag variant="neutral">en</Tag>
          ) : (
            supportedLocales.map((locale) => (
              <Tag key={locale} variant="neutral">
                {locale}
              </Tag>
            ))
          )}
        </div>
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
