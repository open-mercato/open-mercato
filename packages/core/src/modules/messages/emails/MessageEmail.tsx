import React from 'react'
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Text,
  Section,
  Link,
  Hr,
} from '@react-email/components'

export type MessageEmailCopy = {
  preview: string
  heading: string
  from: string
  sentAt: string
  viewCta: string
  attachmentsLabel: string
  objectsLabel: string
  footer: string
}

export type MessageEmailProps = {
  subject: string
  body: string
  bodyHtml?: string | null
  senderName: string
  sentAtLabel: string
  viewUrl?: string | null
  copy: MessageEmailCopy
  attachmentNames?: string[]
  objectLabels?: string[]
}

export function MessageEmail({
  subject,
  body,
  bodyHtml,
  senderName,
  sentAtLabel,
  viewUrl,
  copy,
  attachmentNames,
  objectLabels,
}: MessageEmailProps) {
  return (
    <Html>
      <Head>
        <title>{subject}</title>
      </Head>
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', padding: '12px 0' }}>
        <Container
          style={{
            padding: '0 16px',
            margin: '0 auto',
            maxWidth: '640px',
          }}
        >
          <Text style={{ margin: '0 0 8px', fontSize: '14px', color: '#202124' }}>{copy.heading}</Text>
          <Text style={{ margin: '0 0 4px', color: '#5f6368', fontSize: '14px' }}>
            {copy.from}: {senderName}
          </Text>
          <Text style={{ margin: '0 0 16px', color: '#5f6368', fontSize: '14px' }}>
            {copy.sentAt}: {sentAtLabel}
          </Text>
          <Text style={{ margin: '0 0 12px', fontSize: '20px', lineHeight: 1.3, color: '#202124' }}>{subject}</Text>
          <Section
            style={{
              whiteSpace: bodyHtml ? 'normal' : 'pre-wrap',
              color: '#202124',
              fontSize: '14px',
              lineHeight: 1.5,
            }}
          >
            {bodyHtml ? (
              <div
                style={{ margin: 0 }}
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <Text style={{ margin: 0 }}>{body}</Text>
            )}
          </Section>

          {viewUrl ? (
            <Section style={{ marginTop: '16px' }}>
              <Text style={{ margin: 0, fontSize: '14px', color: '#202124' }}>
                <Link href={viewUrl} style={{ color: '#1a73e8', textDecoration: 'none' }}>
                  {copy.viewCta}
                </Link>
              </Text>
            </Section>
          ) : null}

          {attachmentNames?.length ? (
            <>
              <Hr style={{ borderColor: '#dadce0', margin: '20px 0 12px' }} />
              <Text style={{ margin: '0 0 8px', fontSize: '13px', color: '#202124', fontWeight: 600 }}>
                {copy.attachmentsLabel}
              </Text>
              {attachmentNames.slice(0, 5).map((name) => (
                <Text key={name} style={{ margin: '0 0 4px', fontSize: '13px', color: '#202124' }}>
                  • {name}
                </Text>
              ))}
            </>
          ) : null}

          {objectLabels?.length ? (
            <>
              <Hr style={{ borderColor: '#dadce0', margin: '20px 0 12px' }} />
              <Text style={{ margin: '0 0 8px', fontSize: '13px', color: '#202124', fontWeight: 600 }}>
                {copy.objectsLabel}
              </Text>
              {objectLabels.slice(0, 5).map((label) => (
                <Text key={label} style={{ margin: '0 0 4px', fontSize: '13px', color: '#202124' }}>
                  • {label}
                </Text>
              ))}
            </>
          ) : null}

          <Hr style={{ borderColor: '#dadce0', margin: '24px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: '12px', color: '#5f6368' }}>{copy.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default MessageEmail
