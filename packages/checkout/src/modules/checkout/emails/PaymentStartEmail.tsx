import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Hr } from '@react-email/components'

export type PaymentStartEmailProps = {
  firstName: string
  amount: string
  currencyCode: string
  linkTitle: string
  bodyHtml?: string | null
  copy: {
    title: string
    preview: string
    greeting: string
    message: string
    hint: string
  }
}

const styles = {
  body: { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif' } as React.CSSProperties,
  container: { backgroundColor: '#ffffff', borderRadius: 12, padding: 32, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as React.CSSProperties,
  title: { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' } as React.CSSProperties,
  paragraph: { fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' } as React.CSSProperties,
  amountStyle: { fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 4px' } as React.CSSProperties,
  hint: { fontSize: 12, color: '#9ca3af', margin: '16px 0 0' } as React.CSSProperties,
}

export function PaymentStartEmail({ amount, currencyCode, bodyHtml, copy }: PaymentStartEmailProps) {
  return (
    <Html>
      <Head><title>{copy.title}</title></Head>
      <Preview>{copy.preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Text style={styles.title}>{copy.title}</Text>
            {bodyHtml ? (
              <div style={{ fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <>
                <Text style={styles.paragraph}>{copy.greeting}</Text>
                <Text style={styles.amountStyle}>{amount} {currencyCode}</Text>
                <Text style={styles.paragraph}>{copy.message}</Text>
              </>
            )}
            <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
            <Text style={styles.hint}>{copy.hint}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PaymentStartEmail
