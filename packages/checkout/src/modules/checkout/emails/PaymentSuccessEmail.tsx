import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Hr } from '@react-email/components'

export type PaymentSuccessEmailProps = {
  firstName: string
  amount: string
  currencyCode: string
  linkTitle: string
  transactionId: string
}

const body: React.CSSProperties = { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif' }
const container: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: 12, padding: 32, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const title: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' }
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' }
const amountStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, color: '#16a34a', margin: '0 0 4px' }
const mono: React.CSSProperties = { fontSize: 12, fontFamily: 'monospace', color: '#6b7280', margin: '0 0 16px' }
const hint: React.CSSProperties = { fontSize: 12, color: '#9ca3af', margin: '16px 0 0' }

export function PaymentSuccessEmail({ firstName, amount, currencyCode, linkTitle, transactionId }: PaymentSuccessEmailProps) {
  return (
    <Html>
      <Head>
        <title>Payment successful</title>
      </Head>
      <Preview>Your payment of {amount} {currencyCode} was successful</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>Payment successful</Text>
            <Text style={paragraph}>
              Hi {firstName}, your payment for <strong>{linkTitle}</strong> has been completed successfully.
            </Text>
            <Text style={amountStyle}>{amount} {currencyCode}</Text>
            <Text style={mono}>Transaction: {transactionId}</Text>
            <Text style={paragraph}>
              Thank you for your payment. This email serves as your receipt.
            </Text>
            <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
            <Text style={hint}>
              Please keep this email for your records.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PaymentSuccessEmail
