import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Hr } from '@react-email/components'

export type PaymentErrorEmailProps = {
  firstName: string
  linkTitle: string
  errorMessage?: string | null
  bodyHtml?: string | null
}

const styles = {
  body: { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif' } as React.CSSProperties,
  container: { backgroundColor: '#ffffff', borderRadius: 12, padding: 32, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as React.CSSProperties,
  title: { fontSize: 20, fontWeight: 600, color: '#dc2626', margin: '0 0 12px' } as React.CSSProperties,
  paragraph: { fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' } as React.CSSProperties,
  errorBox: { backgroundColor: '#fef2f2', borderRadius: 8, padding: '12px 16px', margin: '0 0 16px' } as React.CSSProperties,
  errorText: { fontSize: 13, color: '#991b1b', margin: 0 } as React.CSSProperties,
  hint: { fontSize: 12, color: '#9ca3af', margin: '16px 0 0' } as React.CSSProperties,
}

export function PaymentErrorEmail({ firstName, linkTitle, errorMessage, bodyHtml }: PaymentErrorEmailProps) {
  return (
    <Html>
      <Head><title>Payment failed</title></Head>
      <Preview>Your payment for {linkTitle} could not be processed</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Text style={styles.title}>Payment failed</Text>
            {bodyHtml ? (
              <div style={{ fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <>
                <Text style={styles.paragraph}>
                  Hi {firstName}, unfortunately your payment for <strong>{linkTitle}</strong> could not be processed.
                </Text>
                {errorMessage ? (
                  <Section style={styles.errorBox}>
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </Section>
                ) : null}
                <Text style={styles.paragraph}>
                  Please try again or use a different payment method. If the problem persists, contact support.
                </Text>
              </>
            )}
            <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
            <Text style={styles.hint}>
              No charges have been applied to your account.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PaymentErrorEmail
