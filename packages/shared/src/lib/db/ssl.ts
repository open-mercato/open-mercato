/**
 * Auto-detect SSL requirement from DATABASE_URL or explicit DB_SSL env var.
 * Returns a pg-compatible SSL config object, or undefined when SSL is not needed.
 */
export function getSslConfig(): { rejectUnauthorized: boolean } | undefined {
  const clientUrl = process.env.DATABASE_URL || ''
  const requireSsl = clientUrl.includes('sslmode=require') ||
                     clientUrl.includes('ssl=true') ||
                     process.env.DB_SSL === 'true'

  if (!requireSsl) {
    return undefined
  }

  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  }
}
