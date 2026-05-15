'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type MessageOverrideRule =
  | 'pattern'
  | 'minLength'
  | 'maxLength'
  | 'minValue'
  | 'maxValue'

export type MessageOverridesEditorProps = {
  locale: string
  applicableRules: ReadonlyArray<MessageOverrideRule>
  messages: { [locale: string]: { [rule: string]: string } } | undefined
  onChange: (next: { rule: MessageOverrideRule; message: string | null }) => void
}

const RULE_LABEL_KEY: Record<MessageOverrideRule, string> = {
  pattern: 'forms.studio.validation.messages.pattern',
  minLength: 'forms.studio.validation.messages.minLength',
  maxLength: 'forms.studio.validation.messages.maxLength',
  minValue: 'forms.studio.validation.messages.minValue',
  maxValue: 'forms.studio.validation.messages.maxValue',
}

export function MessageOverridesEditor({
  locale,
  applicableRules,
  messages,
  onChange,
}: MessageOverridesEditorProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  if (applicableRules.length === 0) return null
  const localeMessages = messages?.[locale] ?? {}
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open
          ? t('forms.studio.validation.messages.toggleHide')
          : t('forms.studio.validation.messages.toggleShow')}
      </Button>
      {open ? (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('forms.studio.validation.messages.heading')}
          </span>
          {applicableRules.map((rule) => {
            const current = typeof localeMessages[rule] === 'string' ? localeMessages[rule] : ''
            return (
              <div key={rule} className="space-y-1">
                <label className="block text-xs text-muted-foreground">
                  {t(RULE_LABEL_KEY[rule])}
                </label>
                <Input
                  value={current}
                  onChange={(event) => {
                    const next = event.target.value
                    onChange({ rule, message: next.length === 0 ? null : next })
                  }}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
