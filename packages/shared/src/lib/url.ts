function resolveRequestOrigin(req: Request): string {
  const url = new URL(req.url)
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host
  return `${proto}://${host}`
}

export function getAppBaseUrl(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    resolveRequestOrigin(req)
  )
}

export function toAbsoluteUrl(req: Request, path: string): string {
  return new URL(path, getAppBaseUrl(req)).toString()
}
