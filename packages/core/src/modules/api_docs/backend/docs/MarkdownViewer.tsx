'use client'

import dynamic from 'next/dynamic'
import type { FC } from 'react'
import '@uiw/react-markdown-preview/markdown.css'

const MarkdownPreview = dynamic(() => import('@uiw/react-markdown-preview'), { ssr: false })

type MarkdownViewerProps = {
  markdown: string
}

export const MarkdownViewer: FC<MarkdownViewerProps> = ({ markdown }) => {
  return <MarkdownPreview source={markdown} style={{ backgroundColor: 'transparent' }} />
}
