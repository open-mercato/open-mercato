"use client"

import * as React from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'
import { Textarea } from './textarea'

export type PromptAreaProps = Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  inputLabel: string
  submitLabel: string
  placeholder?: string
  information?: React.ReactNode
  attachments?: React.ReactNode
  toolbar?: React.ReactNode
  compact?: boolean
  disabled?: boolean
}

export function PromptArea({ value, onValueChange, onSubmit, inputLabel, submitLabel, placeholder, information, attachments, toolbar, compact = false, disabled = false, className, ...props }: PromptAreaProps) {
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  React.useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = '0px'
    input.style.height = `${input.scrollHeight}px`
  }, [value, compact])
  const submit = () => {
    if (!disabled && value.trim()) onSubmit(value.trim())
  }
  return <form data-slot="prompt-area" data-compact={compact} className={cn('flex w-full flex-col bg-muted px-px pb-px pt-2.5', compact ? 'gap-2.25 rounded-ai-prompt-mobile' : 'gap-2.5 rounded-ai-prompt', className)} onSubmit={event => { event.preventDefault(); submit() }} {...props}>
    {information ? <div data-slot="prompt-area-information" className="flex min-h-4 items-center gap-1 px-3 text-xs leading-4 text-muted-foreground">{information}</div> : null}
    <fieldset disabled={disabled} data-slot="prompt-area-editor" className={cn('flex min-w-0 flex-col border-0 bg-background shadow-sm ring-1 ring-inset ring-border transition-shadow hover:shadow-md focus-within:shadow-focus', compact ? 'gap-2.5 rounded-ai-prompt-mobile-inner p-2.5' : 'rounded-ai-prompt-inner px-3 pb-3 pt-3.5', !compact && (attachments ? 'gap-3.5' : 'gap-7.75'))}>
      {attachments ? <div data-slot="prompt-area-attachments" className="flex flex-wrap items-center gap-3">{attachments}</div> : null}
      <Textarea ref={inputRef} aria-label={inputLabel} value={value} onChange={event => onValueChange(event.target.value)} placeholder={placeholder} disabled={disabled} rows={1} className={cn('min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 px-1 shadow-none hover:bg-transparent focus-visible:shadow-none', compact ? 'text-sm leading-5' : 'text-ai-body leading-6')}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />
      <div data-slot="prompt-area-actions" className="flex items-center gap-2"><div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div><Button type="submit" variant="ghost" size="icon" aria-label={submitLabel} disabled={disabled || !value.trim()} className="size-7 rounded-ai-control bg-muted p-1 text-foreground hover:bg-accent active:bg-primary active:text-primary-foreground"><ArrowUp aria-hidden="true" className="size-5" /></Button></div>
    </fieldset>
  </form>
}
