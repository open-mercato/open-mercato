export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { scheduleDevRouteWarmup } = await import('@/lib/dev/routeWarmup')
  scheduleDevRouteWarmup()
}
