import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import type { IconOption } from './dictionaryAppearance'
import { AppearanceSelector, type AppearanceSelectorLabels } from './AppearanceSelector'

type AppearanceValue = {
  color: string | null
  icon: string | null
}

type DictionaryFormState = DictionaryFormValues & {
  appearance?: AppearanceValue
}

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
  const initialFormValues = React.useMemo<DictionaryFormState>(() => ({
    ...initialValues,
    appearance: {
      color: initialValues.color ?? null,
      icon: initialValues.icon ?? null,
    },
  }), [initialValues])

  const fields = React.useMemo<CrudField[]>(() => {
    const valueField: CrudField = {
      id: 'value',
      label: translations.valueLabel,
      type: 'text',
      required: true,
      description: translations.valueDescription,
    }
    const labelField: CrudField = {
      id: 'label',
      label: translations.labelLabel,
      type: 'text',
    }
    const appearanceField: CrudField = {
      id: 'appearance',
      label: translations.appearance.iconLabel,
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        const appearance = value && typeof value === 'object'
          ? (value as AppearanceValue)
          : { color: null, icon: null }
        const currentColor = typeof appearance.color === 'string' ? appearance.color : null
        const currentIcon = typeof appearance.icon === 'string' ? appearance.icon : null
        return (
          <AppearanceSelector
            icon={currentIcon}
            color={currentColor}
            onIconChange={(next) => {
              const sanitized = typeof next === 'string' && next.trim().length ? next.trim() : null
              setValue({
                color: currentColor,
                icon: sanitized,
              })
            }}
            onColorChange={(next) => {
              const sanitized = typeof next === 'string' && next.trim().length ? next.trim() : null
              setValue({
                color: sanitized,
                icon: currentIcon,
              })
            }}
            labels={translations.appearance}
            iconSuggestions={iconSuggestions}
            iconLibrary={iconLibrary}
            disabled={Boolean(disabled) || submitting}
          />
        )
      },
    }
    return [valueField, labelField, appearanceField]
  }, [iconLibrary, iconSuggestions, mode, submitting, translations])

  return (
    <div className="space-y-4">
      <CrudForm<DictionaryFormState>
        title={translations.title}
        fields={fields}
        initialValues={initialFormValues}
        submitLabel={translations.saveLabel}
        embedded
        extraActions={
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {translations.cancelLabel}
          </Button>
        }
        isLoading={false}
        onSubmit={async (values) => {
          const appearance = values.appearance && typeof values.appearance === 'object'
            ? values.appearance as AppearanceValue
            : { color: null, icon: null }
          const submittedColor =
            typeof appearance.color === 'string' && appearance.color.trim().length
              ? appearance.color.trim()
              : null
          const submittedIcon =
            typeof appearance.icon === 'string' && appearance.icon.trim().length
              ? appearance.icon.trim()
              : null
          await onSubmit({
            value: values.value.trim(),
            label: values.label?.trim() || values.value.trim(),
            color: submittedColor,
            icon: submittedIcon,
          })
        }}
      />
    </div>
  )
}
