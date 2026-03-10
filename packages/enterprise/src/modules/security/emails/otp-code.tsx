import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'

export type OtpCodeEmailCopy = {
  preview: string
  title: string
  body: string
  codeLabel: string
  expiry: string
  hint: string
}

export type OtpCodeEmailProps = {
  code: string
  expiresInMinutes: number
  copy?: Partial<OtpCodeEmailCopy>
}

const defaultCopy: OtpCodeEmailCopy = {
  preview: 'Your Open Mercato verification code',
  title: 'Verify your sign in',
  body: 'Use the one-time code below to complete sign in.',
  codeLabel: 'Verification code',
  expiry: 'This code expires in {minutes} minutes.',
  hint: 'If you did not request this code, you can ignore this email.',
}

export function OtpCodeEmail({ code, expiresInMinutes, copy }: OtpCodeEmailProps) {
  const mergedCopy: OtpCodeEmailCopy = {
    ...defaultCopy,
    ...(copy ?? {}),
  }
  const expiry = mergedCopy.expiry.replace('{minutes}', String(expiresInMinutes))

  return (
    <Html>
      <Head />
      <Preview>{mergedCopy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>{mergedCopy.title}</Text>
            <Text style={paragraph}>{mergedCopy.body}</Text>
            <Text style={label}>{mergedCopy.codeLabel}</Text>
            <Text style={codeStyle}>{code}</Text>
            <Text style={expiryStyle}>{expiry}</Text>
            <Text style={hint}>{mergedCopy.hint}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0' }
const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: 12,
  padding: 24,
  margin: '0 auto',
  maxWidth: 520,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}
const title: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' }
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '20px', margin: '0 0 16px' }
const label: React.CSSProperties = { fontSize: 12, color: '#6b7280', margin: '0 0 6px' }
const codeStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: '0.2em',
  color: '#111827',
  margin: '0 0 12px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
}
const expiryStyle: React.CSSProperties = { fontSize: 13, color: '#4b5563', margin: '0 0 12px' }
const hint: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 16 }

export default OtpCodeEmail
