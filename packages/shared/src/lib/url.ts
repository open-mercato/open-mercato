export function getAppBaseUrl(req: Request): string {
  const url = new URL(req.url)
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    `${url.protocol}//${url.host}`
  )
}

export function toAbsoluteUrl(req: Request, path: string): string {
  return new URL(path, getAppBaseUrl(req)).toString()
}
