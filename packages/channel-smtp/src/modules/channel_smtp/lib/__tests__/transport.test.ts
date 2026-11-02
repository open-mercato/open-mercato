import { credentialsToConnection } from '../transport'

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
