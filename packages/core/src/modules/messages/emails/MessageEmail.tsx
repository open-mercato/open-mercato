import React from 'react'
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Section,
  Button,
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
      <Body style={{ backgroundColor: '#f5f7fb', fontFamily: 'Helvetica, Arial, sans-serif', padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            padding: '28px',
            borderRadius: '12px',
            margin: '0 auto',
            maxWidth: '560px',
          }}
        >
          <Heading style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 600 }}>{copy.heading}</Heading>
          <Text style={{ margin: '0 0 4px', color: '#475569', fontSize: '14px' }}>
            {copy.from}: {senderName}
          </Text>
          <Text style={{ margin: '0 0 16px', color: '#475569', fontSize: '14px' }}>
            {copy.sentAt}: {sentAtLabel}
          </Text>
          <Text style={{ margin: '0 0 16px', fontSize: '18px', color: '#111827', fontWeight: 600 }}>{subject}</Text>
          <Section
            style={{
              whiteSpace: 'pre-wrap',
              color: '#1f2937',
              fontSize: '14px',
              lineHeight: 1.6,
            }}
          >
            {body}
          </Section>

          {viewUrl ? (
            <Section style={{ textAlign: 'center', margin: '24px 0 16px' }}>
              <Button
                href={viewUrl}
                style={{
                  backgroundColor: '#111827',
                  color: '#ffffff',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  textDecoration: 'none',
                }}
              >
                {copy.viewCta}
              </Button>
            </Section>
          ) : null}

          {attachmentNames?.length ? (
            <>
              <Hr style={{ borderColor: '#e2e8f0', margin: '20px 0 12px' }} />
              <Text style={{ margin: '0 0 8px', fontSize: '13px', color: '#334155', fontWeight: 600 }}>
                {copy.attachmentsLabel}
              </Text>
              {attachmentNames.slice(0, 5).map((name) => (
                <Text key={name} style={{ margin: '0 0 4px', fontSize: '13px', color: '#334155' }}>
                  • {name}
                </Text>
              ))}
            </>
          ) : null}

          {objectLabels?.length ? (
            <>
              <Hr style={{ borderColor: '#e2e8f0', margin: '20px 0 12px' }} />
              <Text style={{ margin: '0 0 8px', fontSize: '13px', color: '#334155', fontWeight: 600 }}>
                {copy.objectsLabel}
              </Text>
              {objectLabels.slice(0, 5).map((label) => (
                <Text key={label} style={{ margin: '0 0 4px', fontSize: '13px', color: '#334155' }}>
                  • {label}
                </Text>
              ))}
            </>
          ) : null}

          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>{copy.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default MessageEmail
