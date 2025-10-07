import { getAuthFromCookies } from '@/lib/auth/server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
}

type Option = { value: string; label: string }

const ALL: Option[] = [
  { value: 'u_123', label: 'Alice Johnson' },
  { value: 'u_456', label: 'Bob Smith' },
  { value: 'u_789', label: 'Charlie Adams' },
  { value: 'u_321', label: 'Daria Lopez' },
  { value: 'u_654', label: 'Evan Kim' },
  { value: 'u_987', label: 'Fatima Khan' },
]

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.orgId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').toLowerCase().trim()
    const items = q
      ? ALL.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : ALL

    return new Response(JSON.stringify({ items }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

