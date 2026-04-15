import { resolveRequestOrigin } from '@open-mercato/shared/lib/url'

export function buildRequestOriginUrl(req: Request, path: string): string {
  return new URL(path, resolveRequestOrigin(req)).toString()
}
