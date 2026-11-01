import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Link } from '@react-email/components'

// Release 5 Phase 4 (D-R5-6, §10.2, Step 2.7). Shared layout for every buyer-facing
// approval e-mail (the `.requested` fan-out to buyer deciders and the `.decided`
// single send to the requester) — same shape as `customer_accounts/emails/
// CustomerInvitationEmail.tsx`, this module's closest precedent for a buyer-facing
// transactional e-mail.
export type ApprovalEmailCopy = {
  preview: string
  title: string
  body: string
  cta: string
  hint?: string
}

export type ApprovalEmailProps = {
  portalUrl: string
  copy: ApprovalEmailCopy
}

export function ApprovalEmail({ portalUrl, copy }: ApprovalEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>{copy.title}</Text>
            <Text style={paragraph}>{copy.body}</Text>
            <Text>
              <Link href={portalUrl} style={button}>{copy.cta}</Link>
            </Text>
            {copy.hint ? <Text style={hint}>{copy.hint}</Text> : null}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0' }
const container: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: 12, padding: 24, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const title: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' }
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '20px', margin: '0 0 16px' }
const button: React.CSSProperties = { display: 'inline-block', backgroundColor: '#111827', color: '#ffffff', padding: '10px 14px', borderRadius: 8, textDecoration: 'none', fontSize: 14 }
const hint: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 16 }

export default ApprovalEmail
