/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EmailThreadsPanel, type EmailThread, type EmailThreadMessage } from '../EmailThreadsPanel'

/**
 * Who an email is credited to in the thread view.
 *
 * Before conversation/channel sharing, the panel labelled every OUTBOUND message
 * "You", because the only person who could read their own sent mail was its
 * author. Sharing is precisely the feature that breaks that premise: a teammate
 * reads a colleague's sent mail, and "You" would then attribute that colleague's
 * email to the reader. Direction is therefore no longer a proxy for authorship.
 */

function message(overrides: Partial<EmailThreadMessage> = {}): EmailThreadMessage {
  return {
    id: 'L1',
    messageId: 'M1',
    rfcMessageId: null,
    references: [],
    direction: 'outbound',
    fromName: null,
    fromEmail: null,
    to: ['contact@example.com'],
    cc: [],
    subject: 'Quarterly review',
    bodyText: 'Sending the numbers over.',
    sentAt: '2026-05-20T11:00:00.000Z',
    providerKey: 'gmail',
    ...overrides,
  }
}

function thread(messages: EmailThreadMessage[]): EmailThread {
  return {
    threadKey: 'T1',
    subject: 'Quarterly review',
    preview: 'Sending the numbers over.',
    participants: ['contact@example.com'],
    lastMessageAt: '2026-05-20T11:00:00.000Z',
    messageCount: messages.length,
    providerKey: 'gmail',
    lastDirection: messages[messages.length - 1]?.direction ?? 'outbound',
    messages,
  }
}

function renderPanel(messages: EmailThreadMessage[]) {
  return renderWithProviders(<EmailThreadsPanel threads={[thread(messages)]} />)
}

describe('EmailThreadsPanel sender label', () => {
  it('labels the viewer\'s own outbound message "You"', () => {
    renderPanel([message({ authoredByViewer: true })])
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('credits a colleague\'s shared outbound message to them, never to the reader', () => {
    renderPanel([message({ authoredByViewer: false, authorName: 'Ada Owner' })])
    expect(screen.getByText('Ada Owner')).toBeInTheDocument()
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('falls back to the sending address when the colleague has no resolved name', () => {
    renderPanel([message({ authoredByViewer: false, authorName: null, fromEmail: 'ada@org.com' })])
    expect(screen.getByText('ada@org.com')).toBeInTheDocument()
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('falls back to a generic label when neither name nor address is known', () => {
    renderPanel([message({ authoredByViewer: false, authorName: null, fromEmail: null })])
    expect(screen.getByText('A teammate')).toBeInTheDocument()
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('does not claim authorship when the flag is absent (fail-safe for older payloads)', () => {
    renderPanel([message({ fromEmail: 'ada@org.com' })])
    expect(screen.queryByText('You')).not.toBeInTheDocument()
    expect(screen.getByText('ada@org.com')).toBeInTheDocument()
  })

  it('names the external sender on inbound mail, ignoring the authorship flag', () => {
    renderPanel([
      message({
        direction: 'inbound',
        fromName: 'Casey Contact',
        fromEmail: 'casey@example.com',
        authoredByViewer: true,
      }),
    ])
    expect(screen.getByText('Casey Contact <casey@example.com>')).toBeInTheDocument()
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })
})
