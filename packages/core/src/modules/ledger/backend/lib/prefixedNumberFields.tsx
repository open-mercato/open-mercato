'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { ACCOUNT_NUMBER_MAX_LENGTH } from '../../lib/accountNumbering'

// Number inputs for the PL numbering rule (lib/accountNumbering.ts): the
// group's digit (type) or the type's number (account) is shown as a fixed
// prefix and the user types only the ending. The backend enforces the same
// rule whatever the form sends — this is convenience, not the control.

function PrefixedInput({
  id,
  value,
  setValue,
  prefix,
  maxSuffixLength,
  disabled,
  autoFocus,
}: {
  id: string
  value: unknown
  setValue: (value: unknown) => void
  prefix: string | null
  maxSuffixLength: number
  disabled?: boolean
  autoFocus?: boolean
}) {
  const current = typeof value === 'string' ? value : ''
  const lastPrefix = React.useRef<string | null>(prefix)

  // When the group/type changes, keep the typed ending and swap the prefix.
  React.useEffect(() => {
    const previous = lastPrefix.current
    lastPrefix.current = prefix
    if (previous === prefix) return
    const ending = previous && current.startsWith(previous) ? current.slice(previous.length) : current
    if (prefix) setValue(`${prefix}${ending}`)
    else if (previous && current.startsWith(previous)) setValue(ending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix])

  if (!prefix || (current.length > 0 && !current.startsWith(prefix))) {
    return (
      <Input
        id={id}
        value={current}
        maxLength={ACCOUNT_NUMBER_MAX_LENGTH}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
      />
    )
  }

  return (
    <div className="flex items-stretch gap-0">
      <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 font-mono text-sm">
        {prefix}
      </span>
      <Input
        id={id}
        className="rounded-l-none font-mono"
        value={current.slice(prefix.length)}
        maxLength={maxSuffixLength}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => setValue(`${prefix}${event.target.value}`)}
      />
    </div>
  )
}

/** Type number: the group's code is the fixed first digit (PL, three digits). */
export function TypeNumberField(props: CrudCustomFieldRenderProps) {
  const groupId = typeof props.values?.accountGroupId === 'string' && props.values.accountGroupId ? props.values.accountGroupId : null
  const [groupCode, setGroupCode] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!groupId) {
      setGroupCode(null)
      return
    }
    apiCall<{ items?: Array<{ code?: string }> }>(`/api/ledger/account-groups?ids=${encodeURIComponent(groupId)}`, undefined, {
      fallback: { items: [] },
    })
      .then((response) => {
        if (cancelled) return
        const code = response.result?.items?.[0]?.code
        setGroupCode(typeof code === 'string' && code.length ? code : null)
      })
      .catch(() => {
        if (!cancelled) setGroupCode(null)
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

  return (
    <PrefixedInput
      id={props.id}
      value={props.value}
      setValue={props.setValue}
      prefix={groupCode}
      maxSuffixLength={groupCode ? 3 - groupCode.length : ACCOUNT_NUMBER_MAX_LENGTH}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
    />
  )
}

/** Account number: the type's number is the fixed prefix when the type has a group. */
export function AccountNumberField(props: CrudCustomFieldRenderProps) {
  const typeId = typeof props.values?.accountTypeId === 'string' && props.values.accountTypeId ? props.values.accountTypeId : null
  const [typeNumber, setTypeNumber] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!typeId) {
      setTypeNumber(null)
      return
    }
    apiCall<{ items?: Array<{ number?: string; accountGroupId?: string | null }> }>(
      `/api/ledger/account-types?id=${encodeURIComponent(typeId)}`,
      undefined,
      { fallback: { items: [] } },
    )
      .then((response) => {
        if (cancelled) return
        const item = response.result?.items?.[0]
        setTypeNumber(item?.accountGroupId && typeof item.number === 'string' ? item.number : null)
      })
      .catch(() => {
        if (!cancelled) setTypeNumber(null)
      })
    return () => {
      cancelled = true
    }
  }, [typeId])

  return (
    <PrefixedInput
      id={props.id}
      value={props.value}
      setValue={props.setValue}
      prefix={typeNumber}
      maxSuffixLength={ACCOUNT_NUMBER_MAX_LENGTH - (typeNumber?.length ?? 0)}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
    />
  )
}
