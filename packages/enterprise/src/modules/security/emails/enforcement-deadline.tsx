import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text, Link } from '@react-email/components'

export type EnforcementDeadlineEmailProps = {
  daysRemaining: number | null
  deadlineIsoDate: string | null
  setupUrl: string
}

export function EnforcementDeadlineEmail({
  daysRemaining,
  deadlineIsoDate,
  setupUrl,
}: EnforcementDeadlineEmailProps) {
  const hasDeadline = typeof daysRemaining === 'number' && daysRemaining > 0 && typeof deadlineIsoDate === 'string'
  const isOverdue = !hasDeadline && typeof deadlineIsoDate === 'string'
  const dayLabel = daysRemaining === 1 ? 'day' : 'days'
  const previewText = hasDeadline
    ? `MFA enrollment required in ${daysRemaining} ${dayLabel}`
    : isOverdue
      ? 'MFA enrollment deadline has passed'
      : 'MFA enrollment required immediately'

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>MFA enforcement reminder</Text>
            {hasDeadline ? (
              <>
                <Text style={paragraph}>
                  Your organization requires MFA enrollment. You have <strong>{daysRemaining} {dayLabel}</strong> left
                  to complete setup.
                </Text>
                <Text style={paragraph}>Deadline: {deadlineIsoDate}</Text>
                <Text style={paragraph}>
                  <Link href={setupUrl}>Open Security &amp; MFA settings</Link> and enroll at least one MFA method
                  before the deadline.
                </Text>
                <Text style={hint}>
                  Accounts without MFA after the deadline may lose access until enrollment is completed.
                </Text>
              </>
            ) : isOverdue ? (
              <>
                <Text style={paragraph}>
                  Your MFA enrollment deadline has passed. Set up MFA immediately to keep account access.
                </Text>
                <Text style={paragraph}>Previous deadline: {deadlineIsoDate}</Text>
                <Text style={paragraph}>
                  <Link href={setupUrl}>Open Security &amp; MFA settings</Link> and enroll at least one MFA method now.
                </Text>
              </>
            ) : (
              <>
                <Text style={paragraph}>
                  Your organization requires MFA enrollment with no grace period. Set up MFA immediately to keep account
                  access.
                </Text>
                <Text style={paragraph}>
                  <Link href={setupUrl}>Open Security &amp; MFA settings</Link> and enroll at least one MFA method now.
                </Text>
              </>
            )}
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
