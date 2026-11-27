import { credentialsToConnection, toTransientRejections } from '../transport'

describe('credentialsToConnection', () => {
  it('carries the relay coordinates through unchanged, coercing the port to a number', () => {
    expect(credentialsToConnection({
      host: 'smtp.example.com',
      port: '587',
      tls: 'starttls',
      user: 'mailer',
      password: 'secret',
      fromAddress: 'no-reply@example.com',
    } as never)).toEqual({
      host: 'smtp.example.com',
      port: 587,
      tls: 'starttls',
      user: 'mailer',
      password: 'secret',
    })
  })
})

describe('toTransientRejections', () => {
  it('keeps only the recipients nodemailer reports with a temporary (4xx) code', () => {
    expect(toTransientRejections([
      { recipient: 'busy@example.com', responseCode: 451 },
      { recipient: 'ghost@example.com', responseCode: 550 },
    ])).toEqual(['busy@example.com'])
    expect(toTransientRejections([])).toBeUndefined()
  })
})
