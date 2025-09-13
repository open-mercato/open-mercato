import { Suspense } from 'react'

export const metadata = {
  title: 'Overridden Blog Post',
}

export default function OverriddenBlogPost({ params }: { params: { id: string } }) {
  return (
    <section className="p-6">
      <h1 className="text-2xl font-semibold mb-2">Custom Blog Post Override</h1>
      <p className="text-sm text-muted-foreground mb-4">This page comes from src/modules and overrides the example package.</p>
      <Suspense>
        <article className="prose dark:prose-invert">
          <p>Post id: <span className="font-mono">{params.id}</span></p>
          <p>You can remove this file to fall back to the package implementation.</p>
        </article>
      </Suspense>
    </section>
  )
}

