export function extractApiKeyFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("authorization") ?? "";
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : cookieMatch
      ? decodeURIComponent(cookieMatch[1])
      : null;
}
