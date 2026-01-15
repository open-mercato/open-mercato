import React from 'react'
import { Html, Head, Preview, Body, Container, Heading, Text, Section, Button, Hr } from '@react-email/components'

export type QuoteSentEmailProps = {
  quoteNumber: string
  totalAmount: string
  currencyCode: string
  validUntil: Date
  url: string
}

export function QuoteSentEmail({ quoteNumber, totalAmount, currencyCode, validUntil, url }: QuoteSentEmailProps) {
  const preview = `Quote ${quoteNumber} is ready for review`
  const validUntilText = validUntil.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <Html>
      <Head>
        <title>Quote {quoteNumber}</title>
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
          <Heading style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 16px' }}>Quote {quoteNumber}</Heading>
          <Text style={{ fontSize: '16px', color: '#334155', marginBottom: '12px' }}>
            Total: {totalAmount} {currencyCode}
          </Text>
          <Text style={{ fontSize: '16px', color: '#334155', marginBottom: '16px' }}>Valid until: {validUntilText}</Text>
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button
              href={url}
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
              View quote
            </Button>
          </Section>
          <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0' }} />
          <Text style={{ fontSize: '12px', color: '#94a3b8' }}>Open Mercato · Sales</Text>
        </Container>
      </Body>
    </Html>
  )
}


