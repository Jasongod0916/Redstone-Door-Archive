import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DoorCard } from '@/components/door-card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { listDoorsForOwner } from '@/lib/doors/queries'

export default async function MyBuildsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login?next=/me')

  const doors = await listDoorsForOwner(user.id)

  return (
    <main className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-8 overflow-hidden px-4 py-6 sm:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[22rem] bg-[radial-gradient(circle_at_top_left,_rgba(177,54,34,0.18),_transparent_38%),radial-gradient(circle_at_80%_14%,_rgba(92,78,46,0.18),_transparent_20%)]" />

      <section className="panel-surface metal-line relative flex flex-col gap-6 border border-border px-5 py-6 pt-8 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="glow-red h-3 w-3 bg-primary shadow-[0_0_18px_rgba(177,54,34,0.45)]" />
          <p className="text-primary text-xs uppercase tracking-[0.25em]">My Builds</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <h1 className="text-4xl leading-none font-semibold tracking-[-0.04em] text-balance sm:text-5xl">
              Your doors, in the same live 3D grid.
            </h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6 sm:text-[15px]">
              Review everything you&apos;ve uploaded to the archive, with the same preview cards as the public catalog.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground max-w-[240px] truncate text-xs">
              {user.user_metadata?.full_name ?? user.email}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Back to catalog</Link>
            </Button>
            <Button asChild size="sm" className="glow-red">
              <Link href="/upload">Upload</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm uppercase tracking-[0.22em] text-muted-foreground">My uploads</h2>
          <span className="text-muted-foreground text-xs">{doors.length} results</span>
        </div>

        {doors.length === 0 ? (
          <div className="panel-surface border border-dashed border-border p-16 text-center text-sm text-muted-foreground">
            <p>You haven&apos;t uploaded any doors yet.</p>
            <div className="mt-4">
              <Button asChild size="sm" className="glow-red">
                <Link href="/upload">Upload your first build</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {doors.map((door) => (
              <DoorCard key={door.id} door={door} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
