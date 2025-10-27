import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import type { IconOption } from './dictionaryAppearance'
import { AppearanceSelector, type AppearanceSelectorLabels } from './AppearanceSelector'

export type DictionaryFormValues = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

export type DictionaryFormTranslations = {
  title: string
  valueLabel: string
  labelLabel: string
  saveLabel: string
  cancelLabel: string
  appearance: AppearanceSelectorLabels
  valueDescription?: string
}

type DictionaryFormProps = {
  mode: 'create' | 'edit'
  initialValues: DictionaryFormValues
  onSubmit: (values: DictionaryFormValues) => Promise<void> | void
  onCancel: () => void
  submitting?: boolean
  translations: DictionaryFormTranslations
  iconSuggestions?: IconOption[]
  iconLibrary?: IconOption[]
}

export function DictionaryForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
  translations,
  iconSuggestions,
  iconLibrary,
}: DictionaryFormProps) {
  const fields = React.useMemo<CrudField[]>(() => {
    const valueField: CrudField = {
      id: 'value',
      label: translations.valueLabel,
      type: 'text',
      required: true,
      description: translations.valueDescription,
      autoFocus: mode === 'create',
      maxLength: 150,
    }
    const labelField: CrudField = {
      id: 'label',
      label: translations.labelLabel,
      type: 'text',
      maxLength: 150,
    }
    const appearanceField: CrudField = {
      id: 'appearance',
      type: 'custom',
      component: ({ values, setValue }) => {
        const currentIcon = typeof values?.icon === 'string' ? values.icon : null
        const currentColor = typeof values?.color === 'string' ? values.color : null
        return (
          <AppearanceSelector
            icon={currentIcon}
            color={currentColor}
            onIconChange={(next) => setValue('icon', next)}
            onColorChange={(next) => setValue('color', next)}
            labels={translations.appearance}
            iconSuggestions={iconSuggestions}
            iconLibrary={iconLibrary}
            disabled={submitting}
          />
        )
      },
    }
    return [valueField, labelField, appearanceField]
  }, [iconLibrary, iconSuggestions, mode, submitting, translations])

  return (
    <div className="space-y-4">
      <CrudForm<DictionaryFormValues>
        title={translations.title}
        fields={fields}
        initialValues={initialValues}
        submitLabel={translations.saveLabel}
        embedded
        extraActions={
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {translations.cancelLabel}
          </Button>
        }
        isLoading={false}
        onSubmit={async (values) => {
          await onSubmit({
            value: values.value.trim(),
            label: values.label?.trim() || values.value.trim(),
            color: values.color ? values.color.trim() : null,
            icon: values.icon ? values.icon.trim() : null,
          })
        }}
      />
    </div>
  )
}
