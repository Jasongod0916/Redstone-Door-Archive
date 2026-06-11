'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-[960px] items-center px-4 py-12 sm:px-6">
      <section className="panel-surface metal-line flex w-full flex-col gap-6 border border-border px-5 py-8 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="glow-red h-3 w-3 bg-primary shadow-[0_0_18px_rgba(177,54,34,0.45)]" />
          <p className="text-primary text-xs uppercase tracking-[0.25em]">Render interrupted</p>
        </div>
        <div className="max-w-2xl">
          <h1 className="text-4xl leading-none font-semibold text-balance sm:text-5xl">
            The archive could not finish loading.
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-6 sm:text-[15px]">
            Try again in a moment. If this keeps happening, check the server logs for the matching digest.
          </p>
          {error.digest ? (
            <p className="text-muted-foreground mt-4 font-mono text-xs">Digest: {error.digest}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="glow-red" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to catalog</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
