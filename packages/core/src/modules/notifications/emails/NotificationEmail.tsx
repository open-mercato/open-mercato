import React from 'react'
import { Html, Head, Preview, Body, Container, Heading, Text, Section, Button, Hr } from '@react-email/components'

export type NotificationEmailAction = {
  id: string
  label: string
  href: string
}

export type NotificationEmailCopy = {
  preview: string
  heading: string
  bodyIntro: string
  actionNotice: string
  openCta: string
  footer: string
}

type NotificationEmailProps = {
  title: string
  body?: string | null
  actions: NotificationEmailAction[]
  panelUrl: string
  copy: NotificationEmailCopy
}

export function NotificationEmail({ title, body, actions, panelUrl, copy }: NotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#f5f5f5', fontFamily: 'Arial, sans-serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: '24px' }}>
          <Section style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: 12 }}>
            <Heading as="h1" style={{ fontSize: '22px', margin: '0 0 8px', color: '#111827' }}>
              {copy.heading}
            </Heading>
            <Text style={{ margin: '0 0 16px', color: '#4b5563' }}>{title}</Text>
            {body && (
              <Text style={{ margin: '0 0 16px', color: '#111827', fontSize: '15px' }}>
                {body}
              </Text>
            )}
            <Text style={{ margin: '0 0 16px', color: '#6b7280', fontSize: '13px' }}>
              {copy.bodyIntro}
            </Text>
            {actions.length > 0 && (
              <Section style={{ marginBottom: 16 }}>
                {actions.map((action) => (
                  <Button
                    key={action.id}
                    href={action.href}
                    style={{
                      backgroundColor: '#111827',
                      color: '#ffffff',
                      padding: '10px 16px',
                      borderRadius: 8,
                      textDecoration: 'none',
                      display: 'inline-block',
                      marginRight: 8,
                      marginBottom: 8,
                      fontSize: '13px',
                    }}
                  >
                    {action.label}
                  </Button>
                ))}
              </Section>
            )}
            <Text style={{ margin: '0 0 16px', color: '#6b7280', fontSize: '12px' }}>
              {copy.actionNotice}
            </Text>
            <Button
              href={panelUrl}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                padding: '12px 18px',
                borderRadius: 8,
                textDecoration: 'none',
                display: 'inline-block',
                fontSize: '14px',
              }}
            >
              {copy.openCta}
            </Button>
            <Hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />
            <Text style={{ margin: 0, color: '#9ca3af', fontSize: '12px' }}>
              {copy.footer}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default NotificationEmail
