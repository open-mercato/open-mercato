/**
 * @jest-environment node
 */

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { readDateLocaleEnv, resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DateLocaleSettingsProvider } from '../../../primitives/date-locale-settings'
import { EmailThreadsPanel, type EmailThread } from '../EmailThreadsPanel'

const thread: EmailThread = {
  threadKey: 'T1',
  subject: 'Quarterly review',
  preview: 'Sending the numbers over.',
  participants: ['contact@example.com'],
  lastMessageAt: '2026-05-20T11:00:00.000Z',
  messageCount: 1,
  providerKey: 'gmail',
  lastDirection: 'inbound',
  messages: [
    {
      id: 'L1',
      messageId: 'M1',
      rfcMessageId: null,
      references: [],
      direction: 'inbound',
      fromName: 'Contact',
      fromEmail: 'contact@example.com',
      to: ['me@example.com'],
      cc: [],
      subject: 'Quarterly review',
      bodyText: 'Sending the numbers over.',
      sentAt: '2026-05-20T11:00:00.000Z',
      providerKey: 'gmail',
    },
  ],
}

describe('EmailThreadsPanel server render', () => {
  it('formats thread dates with the provider settings, not the env defaults', () => {
    const settings = resolveDateLocaleSettings({
      tenant: { timeZone: 'Asia/Tokyo', dateTimeFormat: 'dd.MM.yyyy HH:mm' },
      env: readDateLocaleEnv({}),
    })
    const html = renderToString(
      <I18nProvider locale="en" dict={{}}>
        <DateLocaleSettingsProvider value={settings}>
          <EmailThreadsPanel threads={[thread]} />
        </DateLocaleSettingsProvider>
      </I18nProvider>,
    )
    expect(html).toContain('20.05.2026 20:00')
  })
})
