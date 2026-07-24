import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as fs from 'fs'
import * as path from 'path'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

import ChannelPayloadRendererWidget from '../widget.client'

function renderWidget(channelPayloadEnrichment: Record<string, unknown>): string {
  return renderToStaticMarkup(
    <ChannelPayloadRendererWidget
      context={{}}
      data={{ id: 'msg-1', _channelPayload: channelPayloadEnrichment }}
    />,
  )
}

describe('ChannelPayloadRendererWidget', () => {
  it('renders the server-sanitized HTML field for email payloads', () => {
    const html = renderWidget({
      channelContentType: 'email/rfc822',
      channelPayload: { subject: 'Hi' },
      sanitizedHtml: '<p>Hello world</p>',
      interactiveState: null,
      channelMetadata: null,
    })

    expect(html).toContain('<p>Hello world</p>')
  })

  it('does not render an email section when the server provided no sanitized HTML', () => {
    const html = renderWidget({
      channelContentType: 'email/rfc822',
      channelPayload: { text: 'plain only' },
      sanitizedHtml: null,
      interactiveState: null,
      channelMetadata: null,
    })

    expect(html).not.toContain('Channel payload — email')
  })

  it('does not import the HTML sanitizer into the client component bundle', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'widget.client.tsx'), 'utf8')
    // Guard the import graph, not prose: the widget must not pull the sanitizer
    // (or the `sanitize-html` dependency it wraps) into the client bundle.
    expect(source).not.toMatch(/from\s+['"][^'"]*sanitize-channel-html['"]/)
    expect(source).not.toMatch(/from\s+['"]sanitize-html['"]/)
    expect(source).not.toMatch(/require\(\s*['"][^'"]*sanitize-(?:channel-)?html['"]\s*\)/)
    // ...and never invoke the sanitizer at render time.
    expect(source).not.toMatch(/sanitizeChannelHtml\s*\(/)
  })
})
