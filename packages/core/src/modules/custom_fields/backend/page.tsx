export default function CustomFieldsHome() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Custom Fields</h1>
      <p className="text-sm text-muted-foreground">Manage dynamic field definitions and usage across entities.</p>
      <ul className="list-disc list-inside text-sm">
        <li><a href="/backend/custom_fields/definitions" className="text-blue-600 hover:underline">Definitions</a></li>
      </ul>
    </div>
  )
}

