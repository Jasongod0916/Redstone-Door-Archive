import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/guard'
import { listFeaturedForAdmin, listAddableDoors } from '@/lib/admin/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FeaturedRowActions, AddButton } from '@/components/admin/featured-row-actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AdminCurationPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin()
  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q : ''

  const [featured, addable] = await Promise.all([
    listFeaturedForAdmin(),
    listAddableDoors({ search: search || undefined, limit: 30 }),
  ])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Curation</h1>
        <p className="text-muted-foreground text-sm">
          {featured.length} featured · {addable.length} available{search ? ' (filtered)' : ''}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs tracking-widest uppercase text-muted-foreground">Featured doors</h2>
        {featured.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No featured doors yet — add some below.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card">
            {featured.map((door, i) => (
              <li key={door.id} className="flex items-center gap-4 p-3">
                {door.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={door.thumbnail_url}
                    alt=""
                    className="w-20 h-12 object-cover border border-border"
                  />
                ) : (
                  <div className="w-20 h-12 bg-muted" />
                )}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <Link href={`/view/${door.id}`} className="truncate hover:text-primary">
                    {door.title}
                  </Link>
                  <span className="text-muted-foreground text-xs truncate">by {door.author}</span>
                </div>
                <Badge
                  variant="secondary"
                  className="border-primary/30 bg-primary/10 text-primary text-xs"
                >
                  {door.door_size}
                </Badge>
                <FeaturedRowActions
                  doorId={door.id}
                  title={door.title}
                  isFirst={i === 0}
                  isLast={i === featured.length - 1}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs tracking-widest uppercase text-muted-foreground">Add to featured</h2>
        <form className="flex items-end gap-3 border border-border bg-card p-4">
          <div className="flex flex-col gap-1.5 min-w-[220px]">
            <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="q">
              Search
            </label>
            <Input id="q" name="q" defaultValue={search} placeholder="Title, author…" />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>
        {addable.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {search ? 'No non-featured doors match the search.' : 'Every live door is already featured.'}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card">
            {addable.map((door) => (
              <li key={door.id} className="flex items-center gap-4 p-3">
                {door.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={door.thumbnail_url}
                    alt=""
                    className="w-20 h-12 object-cover border border-border"
                  />
                ) : (
                  <div className="w-20 h-12 bg-muted" />
                )}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <Link href={`/view/${door.id}`} className="truncate hover:text-primary">
                    {door.title}
                  </Link>
                  <span className="text-muted-foreground text-xs truncate">by {door.author}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {door.door_size}
                </Badge>
                <AddButton doorId={door.id} title={door.title} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
