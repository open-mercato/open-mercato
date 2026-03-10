import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text, Link } from '@react-email/components'

export type EnforcementDeadlineEmailProps = {
  daysRemaining: number
  deadlineIsoDate: string
  setupUrl: string
}

export function EnforcementDeadlineEmail({
  daysRemaining,
  deadlineIsoDate,
  setupUrl,
}: EnforcementDeadlineEmailProps) {
  const dayLabel = daysRemaining === 1 ? 'day' : 'days'

  return (
    <Html>
      <Head />
      <Preview>MFA enrollment required in {daysRemaining} {dayLabel}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>MFA enforcement reminder</Text>
            <Text style={paragraph}>
              Your organization requires MFA enrollment. You have <strong>{daysRemaining} {dayLabel}</strong> left to
              complete setup.
            </Text>
            <Text style={paragraph}>Deadline: {deadlineIsoDate}</Text>
            <Text style={paragraph}>
              <Link href={setupUrl}>Open Security &amp; MFA settings</Link> and enroll at least one MFA method before
              the deadline.
            </Text>
            <Text style={hint}>
              Accounts without MFA after the deadline may lose access until enrollment is completed.
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

export default EnforcementDeadlineEmail
