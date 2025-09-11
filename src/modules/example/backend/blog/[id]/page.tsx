export default function ExampleAdminBlogPost({ params }: { params: { id: string } }) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">Example Admin Blog Post</h2>
      <p className="text-sm text-muted-foreground">Post ID: {params.id}</p>
    </div>
  )
}

