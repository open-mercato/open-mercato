import React from 'react'
import { Html, Head, Preview, Body, Container, Heading, Text, Section, Button, Hr } from '@react-email/components'

export type QuoteAcceptedAdminEmailProps = {
  quoteNumber: string
  orderNumber: string
  orderUrl: string
}

export function QuoteAcceptedAdminEmail({ quoteNumber, orderNumber, orderUrl }: QuoteAcceptedAdminEmailProps) {
  const preview = `Quote ${quoteNumber} accepted`
  return (
    <Html>
      <Head>
        <title>Quote accepted</title>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: '#f1f5f9', fontFamily: 'Helvetica, Arial, sans-serif', padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '12px',
            margin: '0 auto',
            maxWidth: '520px',
          }}
        >
          <Heading style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 16px' }}>
            Quote {quoteNumber} accepted
          </Heading>
          <Text style={{ fontSize: '16px', color: '#334155', marginBottom: '16px' }}>
            The customer accepted quote {quoteNumber}. An order has been created: {orderNumber}.
          </Text>
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button
              href={orderUrl}
              style={{
                backgroundColor: '#111827',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '15px',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              View order
            </Button>
          </Section>
          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0' }} />
          <Text style={{ fontSize: '12px', color: '#94a3b8' }}>Open Mercato · Sales</Text>
        </Container>
      </Body>
    </Html>
  )
}


