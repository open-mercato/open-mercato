import React from 'react'
import { Html, Head, Preview, Body, Container, Heading, Text, Hr } from '@react-email/components'

export type AdminNotificationCopy = {
  preview: string
  heading: string
  body: string
  footer: string
}

type AdminNotificationEmailProps = {
  copy: AdminNotificationCopy
}

export default function AdminNotificationEmail({ copy }: AdminNotificationEmailProps) {
  return (
    <Html>
      <Head>
        <title>{copy.heading}</title>
      </Head>
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#f8fafc', fontFamily: 'Helvetica, Arial, sans-serif', padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '28px', borderRadius: '12px', margin: '0 auto', maxWidth: '520px' }}>
          <Heading style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px', color: '#0f172a' }}>{copy.heading}</Heading>
          <Text style={{ fontSize: '15px', color: '#1f2937', lineHeight: '24px', marginBottom: '20px' }}>{copy.body}</Text>
          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0' }} />
          <Text style={{ fontSize: '13px', color: '#64748b' }}>{copy.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}
