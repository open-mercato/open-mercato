import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import type { RecordCardPayload } from './records/types'

type MarkdownNode = {
  type: string
  alt?: string | null
  value?: string
  children?: MarkdownNode[]
}

function replaceImagesWithAltText(node: MarkdownNode): void {
  if (!node.children) return
  node.children = node.children.map((child) => {
    if (child.type === 'image' || child.type === 'imageReference') {
      return { type: 'text', value: child.alt ?? '' }
    }
    replaceImagesWithAltText(child)
    return child
  })
}

function remarkBlockAiImages() {
  return replaceImagesWithAltText
}

export const AI_MARKDOWN_PLUGINS: PluggableList = [remarkGfm, remarkBlockAiImages]

export function withoutAiRecordImages(payload: RecordCardPayload): RecordCardPayload {
  switch (payload.kind) {
    case 'person':
      return { ...payload, avatarUrl: null }
    case 'company':
      return { ...payload, logoUrl: null }
    case 'product':
      return { ...payload, imageUrl: null }
    default:
      return payload
  }
}
