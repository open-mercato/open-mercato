import { buildSync } from 'esbuild'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

const content = [
  '**Visible answer**',
  '![Inline image](https://ai-image-canary.invalid/pixel)',
  '![Reference image][canary]\n\n[canary]: https://ai-image-canary.invalid/pixel',
  '![Relative image](/canary)',
  '![Protocol image](//ai-image-canary.invalid/pixel)',
  '<img src="https://ai-image-canary.invalid/pixel" alt="Raw image">',
  '| Detail | Value |\n| --- | --- |\n| Status | Available |',
  '[Ordinary link](https://example.invalid/details)',
].join('\n\n')

function renderSurface(surface: 'assistant' | 'question' | 'user'): string {
  const packageRoot = path.resolve(__dirname, '../../../../..')
  const bundle = buildSync({
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    alias: {
      '@open-mercato/ui': path.resolve(packageRoot, '../ui/src'),
      '@open-mercato/shared': path.resolve(packageRoot, '../shared/src'),
    },
    stdin: {
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'tsx',
      contents: `
        import * as React from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MessageBubble } from './MessageBubble'
        import { ToolChatPage } from './ToolChatPage'
        const content = ${JSON.stringify(content)}
        export const html = renderToStaticMarkup(${JSON.stringify(surface)} === 'question'
          ? <ToolChatPage tool={null} messages={[]} pendingToolCalls={[]} isStreaming={false}
              onApproveToolCall={async () => {}} onRejectToolCall={() => {}}
              pendingQuestion={{ id: 'question', sessionID: 'session', tool: { messageID: 'message', callID: 'call' },
                questions: [{ header: 'Image policy', question: content, options: [{ label: 'Continue', description: '' }] }] }} />
          : <MessageBubble message={{ id: 'answer', role: ${JSON.stringify(surface === 'user' ? 'user' : 'assistant')}, content }} />)
      `,
    },
  })
  const result = { exports: {} as { html: string } }
  runInNewContext(bundle.outputFiles[0].text, {
    module: result, exports: result.exports, require, process, console,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, setImmediate, clearImmediate, queueMicrotask, Buffer,
  })
  return result.exports.html
}

describe('legacy assistant image policy', () => {
  it.each(['assistant', 'question'] as const)('blocks images in %s Markdown while retaining readable content', (surface) => {
    const html = renderSurface(surface)
    expect(html).not.toMatch(/<img\b|<link[^>]+as="image"/)
    expect(html).toContain('Inline image')
    expect(html).toContain('Reference image')
    expect(html).toContain('<strong>Visible answer</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('href="https://example.invalid/details"')
  })

  it('keeps user messages as plain text', () => {
    const html = renderSurface('user')
    expect(html).toContain('![Inline image]')
    expect(html).not.toContain('<strong>')
    expect(html).not.toMatch(/<img\b/)
  })
})
