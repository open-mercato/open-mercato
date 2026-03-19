import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Hr } from '@react-email/components'

export type PaymentStartEmailProps = {
  firstName: string
  amount: string
  currencyCode: string
  linkTitle: string
}

const body: React.CSSProperties = { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif' }
const container: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: 12, padding: 32, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const title: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' }
const paragraph: React.CSSProperties = { fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' }
const amountStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 4px' }
const hint: React.CSSProperties = { fontSize: 12, color: '#9ca3af', margin: '16px 0 0' }

export function PaymentStartEmail({ firstName, amount, currencyCode, linkTitle }: PaymentStartEmailProps) {
  return (
    <Html>
      <Head>
        <title>Payment initiated</title>
      </Head>
      <Preview>Your payment of {amount} {currencyCode} is being processed</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={title}>Payment initiated</Text>
            <Text style={paragraph}>
              Hi {firstName}, your payment for <strong>{linkTitle}</strong> has been initiated.
            </Text>
            <Text style={amountStyle}>{amount} {currencyCode}</Text>
            <Text style={paragraph}>
              We are processing your payment. You will receive a confirmation once it is complete.
            </Text>
            <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
            <Text style={hint}>
              If you did not initiate this payment, please contact support.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PaymentStartEmail
