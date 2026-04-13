export async function readNormalizedEmailFromJsonRequest(req: Request): Promise<string | undefined> {
  try {
    const body: unknown = await req.clone().json()
    if (!body || typeof body !== 'object' || !('email' in body)) return undefined

    const email = (body as { email?: unknown }).email
    if (typeof email !== 'string') return undefined

    const normalized = email.trim().toLowerCase()
    return normalized || undefined
  } catch {
    return undefined
  }
}
