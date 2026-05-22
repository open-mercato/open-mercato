/**
 * @deprecated Prefer the DS `RichEditor` primitive from
 * `@open-mercato/ui/primitives/rich-editor` for any new rich-text input.
 *
 * `RichEditor` produces sanitized HTML (with the DS toolbar, color palette,
 * Figma-aligned styling, and auto-overflow toolbar variants). The DS direction
 * is to consolidate on a single rich-text format (HTML) so that user-authored
 * content renders consistently across email, exports, and the customer portal.
 *
 * `SwitchableMarkdownInput` is kept as a backward-compatibility shim for
 * existing Markdown-backed surfaces (notably `customers` Notes). It will be
 * removed once those surfaces migrate their storage format from Markdown to
 * sanitized HTML — track the migration in the spec referenced from
 * `customers/AGENTS.md`.
 *
 * Migration:
 *
 * ```diff
 * - import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs/SwitchableMarkdownInput'
 * - <SwitchableMarkdownInput value={md} onChange={setMd} isMarkdownEnabled={enabled} />
 * + import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'
 * + <RichEditor value={html} onChange={setHtml} variant="basic" />
 * ```
 *
 * For surfaces that genuinely need plain Markdown storage (e.g. agent prompts,
 * code-adjacent docs), keep using `SwitchableMarkdownInput` until a Markdown
 * mode lands on `RichEditor` — but do NOT introduce new Markdown surfaces.
 */
"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
import { LoadingMessage } from '../detail/LoadingMessage'
import { useMarkdownRemarkPlugins } from '../markdown/useMarkdownRemarkPlugins'
import { useTheme } from '../../theme'

/** @deprecated See module-level JSDoc. */
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

const isTestEnv =
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined')

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

/** @deprecated Use `RichEditor` from `@open-mercato/ui/primitives/rich-editor` for new code. See module JSDoc. */
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
  const { resolvedTheme } = useTheme()
  const editorWrapperClasses =
    editorWrapperClassName ?? 'w-full rounded-lg border border-muted-foreground/20 bg-background p-2'
  const editorClasses = editorClassName ?? 'w-full'
  const textareaClasses =
    textareaClassName
    ?? 'w-full resize-none overflow-hidden rounded-lg border border-muted-foreground/20 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  if (isMarkdownEnabled && !disableMarkdown) {
    return (
      <div className={editorWrapperClasses}>
        <div data-color-mode={resolvedTheme} className={editorClasses}>
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
