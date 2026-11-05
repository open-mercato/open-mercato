/** @jest-environment node */

describe('customers assignable-staff route (deprecated redirect)', () => {
  it('returns 308 Permanent Redirect to the staff route preserving the query string', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/assignable-staff?page=2&pageSize=100&search=ada%20l'),
    )
    expect(response.status).toBe(308)
    const location = response.headers.get('location')
    expect(location).not.toBeNull()
    const target = new URL(location as string)
    expect(target.pathname).toBe('/api/staff/team-members/assignable')
    expect(target.search).toBe('?page=2&pageSize=100&search=ada%20l')
  })

  it('preserves an empty query string', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/customers/assignable-staff'))
    expect(response.status).toBe(308)
    const target = new URL(response.headers.get('location') as string)
    expect(target.pathname).toBe('/api/staff/team-members/assignable')
    expect(target.search).toBe('')
  })
})
