import * as React from 'react'

/**
 * Render a markdown message body to the HTML an email carries.
 *
 * Shared by every path that delivers a composed message off-platform, so a
 * markdown compose reads the same whether it leaves through the platform sender
 * or through an employee's own mailbox. The renderer dependencies are imported
 * lazily because they are only needed for markdown bodies.
 */
export async function renderMarkdownEmailBody(body: string): Promise<string> {
  const ReactMarkdownModule = await import('react-markdown')
  const remarkGfmModule = await import('remark-gfm')
  const ReactMarkdown =
    (ReactMarkdownModule.default ?? ReactMarkdownModule) as React.ComponentType<{
      remarkPlugins?: unknown
      children?: React.ReactNode
    }>
  const remarkGfmPlugin = remarkGfmModule.default ?? remarkGfmModule
  const { renderToStaticMarkup } = await import('react-dom/server')

  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfmPlugin] }, body),
  )
}
