"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

export type MarkdownFieldProps = {
  value?: string
  onChange: (markdown: string) => void
}

const isTestEnv =
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined')

// Lightweight stand-in for unit tests (jsdom): MDXEditor/Lexical pull in ESM + CSS that jest
// would have to transform, so under test we render a plain controlled textarea instead.
const MarkdownFieldTestStub: ComponentType<MarkdownFieldProps> = ({ value, onChange }) => (
  <textarea
    data-testid="markdown-field"
    className="min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value)}
  />
)

const MarkdownFieldLive = dynamic(() => import('./MdxEditorImpl'), { ssr: false }) as ComponentType<MarkdownFieldProps>

// Canonical Markdown editor for the whole app: a WYSIWYG MDXEditor (Lexical) that emits Markdown.
// Client-only (Lexical needs the DOM), loaded via next/dynamic with ssr disabled. Use this
// everywhere a Markdown editing field is needed.
const MarkdownField: ComponentType<MarkdownFieldProps> = isTestEnv ? MarkdownFieldTestStub : MarkdownFieldLive

export default MarkdownField
