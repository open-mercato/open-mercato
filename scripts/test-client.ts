import { createOpenMercatoClient } from '@open-mercato/client'

async function main() {
  const apiKey = process.env.OPEN_MERCATO_API_KEY
  if (!apiKey) throw new Error('OPEN_MERCATO_API_KEY not set')

  const client = createOpenMercatoClient({
    baseUrl: process.env.OPEN_MERCATO_API_URL || 'http://localhost:3001/api',
    accessToken: () => `ApiKey ${apiKey}`,
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  })

  const res = await client.GET('/customers/deals', {
    params: { query: { page: 1, pageSize: 5 } },
  })

  console.log('status', res.response.status)
  console.log('error', res.error)
  console.log('first item', res.data?.items?.[0])
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
