export const requireAuth = true
export const requireFeatures = ['example.todos.view']
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  return new Response(JSON.stringify({ id: ctx.params.id, method: 'GET' }), {
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  return new Response(JSON.stringify({ id: ctx.params.id, method: 'POST' }), {
    headers: { 'content-type': 'application/json' },
  })
}
