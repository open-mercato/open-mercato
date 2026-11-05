import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'

export type MfaEnrolledEmailProps = {
  methodLabel: string
  enrolledAtIso: string
}

export function MfaEnrolledEmail({ methodLabel, enrolledAtIso }: MfaEnrolledEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New MFA method enabled on your account</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>A new MFA method was enabled</Text>
            <Text style={paragraph}>
              Your account now has multi-factor authentication enabled with <strong>{methodLabel}</strong>.
            </Text>
            <Text style={paragraph}>Activation time: {new Date(enrolledAtIso).toUTCString()}</Text>
            <Text style={hint}>
              If this was not you, contact your administrator and reset your credentials immediately.
            </Text>
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
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '20px', margin: '0 0 12px' }
const hint: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 16 }

export default MfaEnrolledEmail
