import { useMemo } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CrudField, CrudFieldOption } from '../CrudForm'

export function areOptionListsEqual(left: CrudFieldOption[], right: CrudFieldOption[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((option, index) => {
    const other = right[index]
    return option.value === other.value && option.label === other.label && option.labelKey === other.labelKey
  })
}

export function useCrudFieldPresentation(field: CrudField, presentedOptions: CrudFieldOption[]) {
  const t = useT()
  const label = field.labelKey ? t(field.labelKey, field.label) : field.label
  const options = useMemo(() => {
    if (!presentedOptions.some(({ labelKey }) => labelKey)) return presentedOptions
    return presentedOptions.map((option) => option.labelKey ? { ...option, label: t(option.labelKey, option.label) } : option)
  }, [presentedOptions, t])
  return { t, label, options }
}
