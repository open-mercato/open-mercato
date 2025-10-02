// Placeholder for stage-2 vectorization; currently a no-op
export const metadata = { event: 'query_index.vectorize_one', persistent: false }

export default async function handle(_payload: any, _ctx: { resolve: <T=any>(name: string) => T }) {
  // Implement embeddings/vectorization here when available
}


