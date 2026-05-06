import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SchematicViewer from '@/components/schematic-viewer-lazy'
import { getPreferredDoorFile } from '@/lib/doors/files'
import { normalizeMinecraftVersion } from '@/lib/minecraft-version'
import { listAvailableSizes, listDoors, listFeaturedForPublic } from '@/lib/doors/queries'
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
  const { data: { user } } = await supabase.auth.getUser()

  const hasFilter = !!sizeParam || !!search || sort !== 'recent'
  const featured = hasFilter ? [] : await listFeaturedForPublic()
  const excludeIds = featured.map((d) => d.id)

  const [doors, sizes] = await Promise.all([
    listDoors({
      size: sizeParam,
      sort,
      search: search || undefined,
      excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
    }),
    listAvailableSizes(),
  ])

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

type Door = Awaited<ReturnType<typeof listDoors>>[number]

function DoorCard({ door }: { door: Door }) {
  const preferredFile = getPreferredDoorFile(door)
  const minecraftVersion = normalizeMinecraftVersion(door.minecraft_version)

  return (
    <article className="panel-surface group relative flex flex-col overflow-hidden border border-border transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_24px_50px_-34px_rgba(67,34,21,0.55)]">
      {/* Red accent bar */}
      <div className="h-0.5 w-full bg-primary opacity-60 group-hover:opacity-100 transition-opacity" />

      {preferredFile ? (
        <Link
          href={`/view/${door.id}`}
          className="bg-muted relative block aspect-video w-full overflow-hidden border-b border-border"
        >
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/40 via-black/8 to-transparent opacity-90" />
          <div className="absolute left-3 top-3 z-20 border border-white/18 bg-black/55 px-2 py-1 text-[10px] tracking-[0.22em] uppercase text-white/78 backdrop-blur-sm">
            3D Preview
          </div>
          <SchematicViewer
            schematicUrl={preferredFile.url}
            schematicId={`card-${door.id}`}
            className="h-full w-full"
            emptyLabel="Preview unavailable."
            showQualityToggle={false}
          />
        </Link>
      ) : door.thumbnail_url ? (
        <Link
          href={`/view/${door.id}`}
          className="bg-muted relative block aspect-video w-full overflow-hidden border-b border-border"
        >
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/28 via-transparent to-transparent opacity-80" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={door.thumbnail_url}
            alt={`${door.title} preview`}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-hover:opacity-95"
          />
        </Link>
      ) : null}

      <div className="flex flex-col gap-3 p-4">
        {/* Meta */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="border-primary/30 bg-primary/10 text-primary text-xs">
            {door.door_size}
          </Badge>
          {minecraftVersion ? (
            <Badge variant="outline" className="text-xs">{minecraftVersion}</Badge>
          ) : null}
        </div>

        {/* Title */}
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/view/${door.id}`}
            className="font-semibold leading-tight hover:text-primary transition-colors"
          >
            {door.title}
          </Link>
          <span className="text-muted-foreground text-xs">by {door.author}</span>
        </div>

        {/* Description */}
        {door.description ? (
          <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">{door.description}</p>
        ) : null}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 border border-border bg-background/70 p-2">
          <Stat label="Blocks" value={door.block_count ?? '—'} />
          <Stat label="Open" value={door.open_ticks != null ? `${door.open_ticks}t` : '—'} />
          <Stat label="Total" value={door.total_ticks != null ? `${door.total_ticks}t` : '—'} />
        </div>

        {/* Tags */}
        {door.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {door.tags.slice(0, 5).map((t) => (
              <span key={t} className="border border-border px-1.5 py-0.5 text-muted-foreground text-xs">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        {/* CTA */}
        <div className="pt-1">
          <Button asChild size="sm" className="w-full glow-red">
            <Link href={`/view/${door.id}`}>View 3D →</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs tracking-widest uppercase">{label}</span>
      <span className="text-foreground text-sm font-medium tabular-nums">{value}</span>
    </div>
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
