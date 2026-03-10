import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'

export type MfaResetEmailProps = {
  reason: string
  resetAtIso: string
}

export function MfaResetEmail({ reason, resetAtIso }: MfaResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your MFA methods were reset by an administrator</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>Your MFA methods were reset</Text>
            <Text style={paragraph}>
              An administrator reset your multi-factor authentication methods on {new Date(resetAtIso).toUTCString()}.
            </Text>
            <Text style={paragraph}>Reason: {reason}</Text>
            <Text style={paragraph}>
              To keep your account protected, go to Security &amp; MFA settings and enroll a new MFA method.
            </Text>
            <Text style={hint}>
              If you did not expect this change, contact your administrator or support immediately.
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

export default MfaResetEmail
