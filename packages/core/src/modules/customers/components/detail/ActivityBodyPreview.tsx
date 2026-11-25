import { MarkdownPreview, useMarkdownRemarkPlugins } from '@open-mercato/ui/backend/markdown'
import type { InteractionSummary } from './types'

type MarkdownNode = {
  type: string
  value?: string
  alt?: string | null
  children?: MarkdownNode[]
}

const TEXT_CONTAINERS = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell'])

function readMarkdownText(node: MarkdownNode): string {
  if (node.type === 'break') return '\n'
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if (node.value !== undefined) return node.value
  return node.children?.map(readMarkdownText).join(TEXT_CONTAINERS.has(node.type) ? '' : '\n') ?? ''
}

function trimSnippet(text: string): string {
  const normalized = text.trim()
  return normalized.length > 200 ? `${normalized.slice(0, 197)}...` : normalized
}

function activityPlainTextPlugin({ compact }: { compact: boolean }) {
  return (tree: MarkdownNode) => {
    const text = readMarkdownText(tree)
    tree.children = [{ type: 'paragraph', children: [{ type: 'text', value: compact ? trimSnippet(text) : text }] }]
  }
}

function MarkdownActivityBody({ body, compact }: { body: string; compact: boolean }) {
  const plugins = useMarkdownRemarkPlugins()
  return (
    <MarkdownPreview className="contents [&>p]:inline" remarkPlugins={[...plugins, [activityPlainTextPlugin, { compact }]]}>
      {body}
    </MarkdownPreview>
  )
}

export function ActivityBodyPreview({ activity, compact = false }: {
  activity: Pick<InteractionSummary, 'body' | 'bodyFormat'>
  compact?: boolean
}) {
  if (!activity.body) return null
  if (activity.bodyFormat === 'markdown') return <MarkdownActivityBody body={activity.body} compact={compact} />
  return compact ? trimSnippet(activity.body) : activity.body
}
