import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listAvailableSizes, listDoors } from '@/lib/doors/queries'
import { doorSizeLabel } from '@/lib/types/door'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const SORT_OPTIONS: Array<{ value: 'recent' | 'blocks' | 'ticks'; label: string }> = [
  { value: 'recent', label: 'Recently added' },
  { value: 'blocks', label: 'Non-air blocks' },
  { value: 'ticks', label: 'Total ticks' },
]

function parseSize(raw: string | undefined): { w?: number; h?: number } {
  if (!raw) return {}
  const m = raw.match(/^(\d+)x(\d+)$/)
  if (!m) return {}
  return { w: Number(m[1]), h: Number(m[2]) }
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const sizeParam = typeof params.size === 'string' ? params.size : undefined
  const sortParam = typeof params.sort === 'string' ? params.sort : 'recent'
  const search = typeof params.q === 'string' ? params.q : ''
  const sort = (SORT_OPTIONS.find((s) => s.value === sortParam)?.value ?? 'recent') as
    | 'recent' | 'blocks' | 'ticks'

  const { w, h } = parseSize(sizeParam)
  const [doors, sizes] = await Promise.all([
    listDoors({ width: w, height: h, sort, search: search || undefined }),
    listAvailableSizes(),
  ])

  const currentSize = w && h ? doorSizeLabel(w, h) : 'All'

  return (
    <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 p-6">
      <section className="flex flex-col gap-4">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">Redstone Door Archive</p>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-4xl font-semibold tracking-tight">Catalog</h1>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/upload">Upload</Link>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Collect, compare, and preview Minecraft redstone doors. Public browsing — sign in to submit your own build.
        </p>
      </section>

      <section className="flex flex-col gap-4 border border-border p-4">
        <form className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="q" className="text-muted-foreground text-xs tracking-widest uppercase">Search</label>
            <Input id="q" name="q" placeholder="Title, author, description…" defaultValue={search} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="sort" className="text-muted-foreground text-xs tracking-widest uppercase">Sort</label>
            <select
              id="sort"
              name="sort"
              defaultValue={sort}
              className="border-input h-9 border bg-transparent px-2 text-sm"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {sizeParam ? <input type="hidden" name="size" value={sizeParam} /> : null}
          <Button type="submit">Apply</Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs tracking-widest uppercase">Size</span>
          <SizePill href="/" active={!sizeParam} label="All" />
          {sizes.map((s) => {
            const label = doorSizeLabel(s.w, s.h)
            const href = `/?size=${label}${sort !== 'recent' ? `&sort=${sort}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`
            return (
              <SizePill key={label} href={href} active={sizeParam === label} label={`${label}  ·  ${s.count}`} />
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">{currentSize} builds</h2>
          <span className="text-muted-foreground text-sm">{doors.length} shown</span>
        </div>

        {doors.length === 0 ? (
          <div className="border-border text-muted-foreground border border-dashed p-12 text-center text-sm">
            No builds match the current filters yet. {search ? 'Try clearing the search.' : 'Be the first to '}
            {!search && <Link href="/upload" className="underline underline-offset-4">upload one</Link>}{!search ? '.' : ''}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {doors.map((door) => (
              <Card key={door.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{doorSizeLabel(door.door_width, door.door_height)}</Badge>
                    {door.minecraft_version ? <Badge variant="outline">{door.minecraft_version}</Badge> : null}
                  </div>
                  <CardTitle className="leading-tight">
                    <Link href={`/view/${door.id}`} className="hover:underline underline-offset-4">{door.title}</Link>
                  </CardTitle>
                  <CardDescription>by {door.author}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {door.description ? (
                    <p className="text-muted-foreground line-clamp-2 text-sm">{door.description}</p>
                  ) : null}
                  <dl className="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Blocks" value={door.non_air_blocks ?? '—'} />
                    <Stat label="Open/Close" value={`${door.open_ticks ?? '—'} / ${door.close_ticks ?? '—'}`} />
                    <Stat label="Total" value={door.total_ticks ?? '—'} />
                  </dl>
                  <div className="flex flex-wrap gap-1.5">
                    {door.tags.slice(0, 6).map((t) => (
                      <Badge key={t} variant="outline" className="font-normal">{t}</Badge>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button asChild size="sm">
                      <Link href={`/view/${door.id}`}>View 3D</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="tracking-widest uppercase">{label}</dt>
      <dd className="text-foreground text-sm font-medium">{value}</dd>
    </div>
  )
}

function SizePill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`border px-3 py-1 text-xs tracking-widest uppercase transition-colors ${
        active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {label}
    </Link>
  )
}
