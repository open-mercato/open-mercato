import Link from 'next/link'
import { designDictionary } from '@/lib/design-dictionary'

export default function NotFound() {
  return (
    <main className="om-catalog-shell mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-normal text-foreground">{designDictionary['design.notFound.title']}</h1>
      <p className="text-sm text-muted-foreground">{designDictionary['design.notFound.body']}</p>
      <Link href="/" className="text-sm text-foreground underline underline-offset-4">{designDictionary['design.notFound.back']}</Link>
    </main>
  )
}
