import React from 'react'
import { Html, Head, Preview, Body, Container, Heading, Text, Hr } from '@react-email/components'

export type FeedbackEmailCopy = {
  preview: string
  heading: string
  body: string
  senderEmailLabel?: string
  senderEmail?: string
  messageLabel: string
  message: string
  marketingConsent: string
  footer: string
}

type FeedbackEmailProps = {
  copy: FeedbackEmailCopy
}

export default function FeedbackEmail({ copy }: FeedbackEmailProps) {
  return (
    <Html>
      <Head>
        <title>{copy.heading}</title>
      </Head>
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#f8fafc', fontFamily: 'Helvetica, Arial, sans-serif', padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '28px', borderRadius: '12px', margin: '0 auto', maxWidth: '520px' }}>
          <Heading style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px', color: '#0f172a' }}>{copy.heading}</Heading>
          <Text style={{ fontSize: '15px', color: '#1f2937', lineHeight: '24px', marginBottom: '12px' }}>{copy.body}</Text>
          {copy.senderEmail ? (
            <>
              <Text style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>
                {copy.senderEmailLabel ?? 'From email:'}
              </Text>
              <Text style={{ fontSize: '14px', color: '#334155', lineHeight: '22px', marginBottom: '16px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                {copy.senderEmail}
              </Text>
            </>
          ) : null}
          {copy.message ? (
            <>
              <Text style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>{copy.messageLabel}</Text>
              <Text style={{ fontSize: '14px', color: '#334155', lineHeight: '22px', marginBottom: '16px', padding: '12px', backgroundColor: '#f1f5f9', borderRadius: '8px', whiteSpace: 'pre-wrap' as any }}>
                {copy.message}
              </Text>
            </>
          ) : null}
          <Text style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>{copy.marketingConsent}</Text>
          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0' }} />
          <Text style={{ fontSize: '12px', color: '#94a3b8' }}>{copy.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}
