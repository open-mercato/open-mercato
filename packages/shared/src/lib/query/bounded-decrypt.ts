/**
 * Maps `items` through `mapper` with at most `concurrency` calls in flight at
 * once, preserving input order in the output. Chunks are processed
 * sequentially; within a chunk, calls run in parallel via `Promise.all`.
 *
 * When `concurrency` is non-positive or `>= items.length`, this is
 * equivalent to a plain `Promise.all(items.map(mapper))`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency <= 0 || items.length <= concurrency) {
    return Promise.all(items.map((item, index) => mapper(item, index)))
  }
  const results: R[] = new Array(items.length)
  for (let start = 0; start < items.length; start += concurrency) {
    const chunk = items.slice(start, start + concurrency)
    const chunkResults = await Promise.all(
      chunk.map((item, offset) => mapper(item, start + offset)),
    )
    for (let i = 0; i < chunkResults.length; i++) results[start + i] = chunkResults[i]
  }
  return results
}
