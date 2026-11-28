'use client'

import * as React from 'react'
import { pl } from 'date-fns/locale'
import { CrudForm, type CrudFormProps } from '@open-mercato/ui/backend/CrudForm'

export function FinanceCrudForm<Values extends Record<string, unknown>>(
  props: CrudFormProps<Values>,
) {
  const fields = React.useMemo(
    () =>
      props.fields.map((field) =>
        field.type === 'date' || field.type === 'datetime-local'
          ? { ...field, locale: pl }
          : field,
      ),
    [props.fields],
  )
  return (
    <div className="min-w-0">
      <CrudForm
        {...props}
        fields={fields}
        disableInitialFocus={props.disableInitialFocus ?? true}
      />
    </div>
  )
}
