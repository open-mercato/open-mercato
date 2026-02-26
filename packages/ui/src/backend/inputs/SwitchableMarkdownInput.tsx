"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
import { LoadingMessage } from '../detail/LoadingMessage'
import { useMarkdownRemarkPlugins } from '../markdown/useMarkdownRemarkPlugins'

export type SwitchableMarkdownInputProps = {
  value: string
  onChange: (value: string) => void
  isMarkdownEnabled: boolean
  disableMarkdown?: boolean
  height?: number
  placeholder?: string
  rows?: number
  textareaRef?: React.Ref<HTMLTextAreaElement>
  onTextareaInput?: React.FormEventHandler<HTMLTextAreaElement>
  textareaClassName?: string
  editorWrapperClassName?: string
  editorClassName?: string
  disabled?: boolean
  remarkPlugins?: PluggableList
}

type UiMarkdownEditorProps = {
  value?: string
  height?: number
  onChange?: (value?: string) => void
  previewOptions?: { remarkPlugins?: unknown[] }
}

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

const MarkdownEditorTestStub: React.ComponentType<UiMarkdownEditorProps> = ({ value, onChange }) => (
  <textarea
    className="min-h-[160px] w-full rounded border px-3 py-2 text-sm"
    value={value ?? ''}
    onChange={(event) => onChange?.(event.target.value)}
  />
)

const UiMarkdownEditor = isTestEnv
  ? MarkdownEditorTestStub
  : (dynamic(() => import('@uiw/react-md-editor'), {
      ssr: false,
      loading: () => (
        <LoadingMessage
          label="Loading editor..."
          className="min-h-[220px] justify-center"
        />
      ),
    }) as unknown as React.ComponentType<UiMarkdownEditorProps>)

export function SwitchableMarkdownInput({
  value,
  onChange,
  isMarkdownEnabled,
  disableMarkdown,
  height = 220,
  placeholder,
  rows = 3,
  textareaRef,
  onTextareaInput,
  textareaClassName,
  editorWrapperClassName,
  editorClassName,
  disabled,
  remarkPlugins,
}: SwitchableMarkdownInputProps) {
  const resolvedPlugins = useMarkdownRemarkPlugins(remarkPlugins)
  const editorWrapperClasses =
    editorWrapperClassName ?? 'w-full rounded-lg border border-muted-foreground/20 bg-background p-2'
  const editorClasses = editorClassName ?? 'w-full'
  const textareaClasses =
    textareaClassName
    ?? 'w-full resize-none overflow-hidden rounded-lg border border-muted-foreground/20 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

  if (isMarkdownEnabled && !disableMarkdown) {
    return (
      <div className={editorWrapperClasses}>
        <div data-color-mode="light" className={editorClasses}>
          <UiMarkdownEditor
            value={value}
            height={height}
            onChange={(nextValue) => onChange(typeof nextValue === 'string' ? nextValue : '')}
            previewOptions={resolvedPlugins.length ? { remarkPlugins: resolvedPlugins } : undefined}
          />
        </div>
      </div>
    )
  }

  return (
    <textarea
      ref={textareaRef}
      rows={rows}
      className={textareaClasses}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onInput={onTextareaInput}
      disabled={disabled}
    />
  )
}
