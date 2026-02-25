import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-light text-gray-200">404</p>
      <h1 className="text-2xl font-light tracking-tight text-gray-900">Page not found</h1>
      <p className="text-gray-500">The page you're looking for doesn't exist.</p>
      <Link
        href="/"
        className="mt-2 rounded-lg border border-gray-200 px-6 py-2 text-sm text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
      >
        Go home
      </Link>
    </div>
  )
}
