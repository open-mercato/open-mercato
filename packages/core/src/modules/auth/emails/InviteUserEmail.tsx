import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Link } from '@react-email/components'

export type InviteUserEmailCopy = {
  preview: string
  title: string
  body: string
  cta: string
  hint: string
}

export type InviteUserEmailProps = {
  inviteUrl: string
  copy: InviteUserEmailCopy
}

export function InviteUserEmail({ inviteUrl, copy }: InviteUserEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={section}>
            <Text style={title}>{copy.title}</Text>
            <Text style={paragraph}>{copy.body}</Text>
            <Text>
              <Link href={inviteUrl} style={button}>{copy.cta}</Link>
            </Text>
            <Text style={hint}>{copy.hint}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0' }
const container: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: 12, padding: 24, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const section: React.CSSProperties = { }
const title: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' }
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '20px', margin: '0 0 16px' }
const button: React.CSSProperties = { display: 'inline-block', backgroundColor: '#111827', color: '#ffffff', padding: '10px 14px', borderRadius: 8, textDecoration: 'none', fontSize: 14 }
const hint: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 16 }

export default InviteUserEmail
