"use client"
export default function ExampleBlogPost({ params }: { params: { id: string } }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-2">Example Blog Post</h1>
      <p className="text-muted-foreground">Post ID: {params.id}</p>
    </div>
  )
}

