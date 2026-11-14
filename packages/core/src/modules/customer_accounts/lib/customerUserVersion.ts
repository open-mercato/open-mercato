/**
 * Optimistic-lock version of a customer user. Rows that were never updated carry a null
 * `updated_at`, which would disable the stale-write check on their first save, so the
 * creation time stands in until the first update records a real version.
 */
export function resolveCustomerUserVersion(user: {
  updatedAt?: Date | null
  createdAt?: Date | null
}): Date | null {
  return user.updatedAt ?? user.createdAt ?? null
}
