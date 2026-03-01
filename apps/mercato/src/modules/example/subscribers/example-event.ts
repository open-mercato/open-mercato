export const metadata = {
  event: 'example.ping',
  persistent: false,
}

export default async function onExamplePing(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  // demo subscriber; keep side-effects minimal
  const _em = ctx.resolve('em')
  if (process.env.NODE_ENV !== 'production') {
    console.log('[example.ping] payload:', payload)
  }
}
