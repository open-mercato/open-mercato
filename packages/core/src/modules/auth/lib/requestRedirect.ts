export function buildRequestOriginUrl(req: Request, path: string): string {
  const url = new URL(req.url)
  return new URL(path, `${url.protocol}//${url.host}`).toString()
}
