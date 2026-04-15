export function buildRequestOriginUrl(req: Request, path: string): string {
  const url = new URL(req.url)
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host
  return new URL(path, `${proto}://${host}`).toString()
}
