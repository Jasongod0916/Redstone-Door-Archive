import Link from 'next/link'
import { DoorCard } from '@/components/door-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listAvailableSizes, listDoors, listFeaturedForPublic } from '@/lib/doors/queries'
import type { DoorCardRow } from '@/lib/doors/queries'
import { createClient } from '@/lib/supabase/server'
import { signOutAction } from '@/app/auth/actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const SORT_OPTIONS: Array<{ value: 'recent' | 'blocks' | 'ticks'; label: string }> = [
  { value: 'recent', label: 'Recently added' },
  { value: 'blocks', label: 'Block count' },
  { value: 'ticks', label: 'Total ticks' },
]

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const sizeParam = typeof params.size === 'string' ? params.size : undefined
  const sortParam = typeof params.sort === 'string' ? params.sort : 'recent'
  const search = typeof params.q === 'string' ? params.q : ''
  const sort = (SORT_OPTIONS.find((s) => s.value === sortParam)?.value ?? 'recent') as
    | 'recent'
    | 'blocks'
    | 'ticks'

  const supabase = await createClient()
  const userResult = await supabase.auth.getUser().catch((error) => {
    logCatalogError('Unable to read auth session', error)
    return null
  })
  const user = userResult?.data.user ?? null

  const hasFilter = !!sizeParam || !!search || sort !== 'recent'
  let catalogError = userResult == null
  let featured: DoorCardRow[] = []
  let doors: DoorCardRow[] = []
  let sizes: Array<{ size: string; count: number }> = []

  if (!hasFilter) {
    const featuredResult = await listFeaturedForPublic().catch((error) => {
      logCatalogError('Unable to load featured doors', error)
      catalogError = true
      return []
    })
    featured = featuredResult
  }

  const excludeIds = featured.map((d) => d.id)

  const [doorsResult, sizesResult] = await Promise.allSettled([
    listDoors({
      size: sizeParam,
      sort,
      search: search || undefined,
      excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
    }),
    listAvailableSizes(),
  ])

  if (doorsResult.status === 'fulfilled') {
    doors = doorsResult.value
  } else {
    logCatalogError('Unable to load doors', doorsResult.reason)
    catalogError = true
  }

  if (sizesResult.status === 'fulfilled') {
    sizes = sizesResult.value
  } else {
    logCatalogError('Unable to load available sizes', sizesResult.reason)
    catalogError = true
  }

  return (
    <main className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-8 overflow-hidden px-4 py-6 sm:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[22rem] bg-[radial-gradient(circle_at_top_left,_rgba(177,54,34,0.18),_transparent_38%),radial-gradient(circle_at_80%_14%,_rgba(92,78,46,0.18),_transparent_20%)]" />

      {/* Header */}
      <section className="panel-surface metal-line relative flex flex-col gap-6 border border-border px-5 py-6 pt-8 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-primary glow-red shadow-[0_0_18px_rgba(177,54,34,0.45)]" />
          <p className="text-primary text-xs tracking-[0.25em] uppercase">Redstone Door Archive</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <h1 className="text-5xl font-semibold tracking-[-0.04em] leading-none text-balance sm:text-6xl">
              Catalog the mechanical drama of every redstone door.
            </h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6 sm:text-[15px]">
              Collect, compare, and preview Minecraft redstone doors. Public browsing — sign in to submit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-muted-foreground text-xs truncate max-w-[160px]">
                  {user.user_metadata?.full_name ?? user.email}
                </span>
                <form action={signOutAction}>
                  <Button type="submit" variant="outline" size="sm" className="cursor-pointer">Sign out</Button>
                </form>
                <Button asChild variant="outline" size="sm">
                  <Link href="/me">My Builds</Link>
                </Button>
                <Button asChild size="sm" className="glow-red">
                  <Link href="/upload">Upload</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href="/auth/login">Sign in</Link>
                </Button>
                <Button asChild size="sm" className="glow-red">
                  <Link href="/upload">Upload</Link>
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="grid gap-3 text-xs tracking-widest uppercase text-muted-foreground sm:grid-cols-3">
          <div className="border border-border bg-background/55 px-3 py-3 backdrop-blur-sm">
            <span className="block text-[10px] text-primary">Viewer</span>
            <span className="mt-1 block text-foreground">Live 3D schematic previews</span>
          </div>
          <div className="border border-border bg-background/55 px-3 py-3 backdrop-blur-sm">
            <span className="block text-[10px] text-primary">Browse</span>
            <span className="mt-1 block text-foreground">Filter by size, timing, and author</span>
          </div>
          <div className="border border-border bg-background/55 px-3 py-3 backdrop-blur-sm">
            <span className="block text-[10px] text-primary">Archive</span>
            <span className="mt-1 block text-foreground">Preserve builds before they vanish</span>
          </div>
        </div>
      </section>

      {/* Signed-out CTA */}
      {!user ? (
        <div className="panel-surface flex items-center justify-between gap-3 border border-primary/35 bg-primary/8 px-4 py-3 text-xs tracking-widest uppercase text-primary">
          <span>Share your build — sign in to upload.</span>
          <Link
            href="/auth/login?next=/upload"
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            Sign in →
          </Link>
        </div>
      ) : null}

      {catalogError ? (
        <div className="panel-surface border border-destructive/35 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          The archive is temporarily unavailable. You can still browse this page, but catalog results may be incomplete.
        </div>
      ) : null}

      {/* Filters */}
      <section className="panel-surface flex flex-col gap-4 border border-border p-4 sm:p-5">
        <form className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5 min-w-[160px]">
            <label htmlFor="q" className="text-muted-foreground text-xs tracking-widest uppercase">
              Search
            </label>
            <Input id="q" name="q" placeholder="Title, author…" defaultValue={search} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sort" className="text-muted-foreground text-xs tracking-widest uppercase">
              Sort
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={sort}
              className="border-input h-9 border bg-muted px-2 text-sm text-foreground"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {sizeParam ? <input type="hidden" name="size" value={sizeParam} /> : null}
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs tracking-widest uppercase mr-1">Size</span>
          <SizePill href="/" active={!sizeParam} label="All" />
          {sizes.map((s) => {
            const href = `/?size=${s.size}${sort !== 'recent' ? `&sort=${sort}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`
            return (
              <SizePill
                key={s.size}
                href={href}
                active={sizeParam === s.size}
                label={`${s.size}  ·  ${s.count}`}
              />
            )
          })}
        </div>
      </section>

      {featured.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm tracking-[0.22em] uppercase text-muted-foreground">Featured</h2>
            <span className="text-[11px] tracking-[0.22em] uppercase text-primary">Curated circuit highlights</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((door) => (
              <DoorCard key={door.id} door={door} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Grid */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm tracking-[0.22em] uppercase text-muted-foreground">
            {sizeParam ? <><span className="text-foreground font-medium">{sizeParam}</span> builds</> : 'All builds'}
          </h2>
          <span className="text-muted-foreground text-xs">{doors.length} results</span>
        </div>

        {doors.length === 0 ? (
          <div className="panel-surface border border-dashed border-border p-16 text-center text-sm text-muted-foreground">
            {search ? (
              'No builds match the search.'
            ) : (
              <>
                No builds yet.{' '}
                <Link href="/upload" className="text-primary underline underline-offset-4">
                  Upload one.
                </Link>
              </>
            )}
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

function SizePill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`border px-3 py-1 text-xs tracking-widest uppercase transition-colors ${
        active
          ? 'border-primary bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgba(177,54,34,0.08)]'
          : 'border-border bg-background/50 text-muted-foreground hover:border-primary/40 hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  )
}

function logCatalogError(message: string, error: unknown) {
  console.error(`[catalog] ${message}`, error)
}
