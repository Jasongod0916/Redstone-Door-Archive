import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { listAdminDoors } from '@/lib/admin/queries'
import { listAvailableSizes } from '@/lib/doors/queries'
import { DoorRowActions } from '@/components/admin/door-row-actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AdminDoorsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q : ''
  const size = typeof params.size === 'string' ? params.size : undefined
  const includeDeleted = params.deleted === '1'

  const [doors, sizes] = await Promise.all([
    listAdminDoors({ search: search || undefined, size, includeDeleted }),
    listAvailableSizes(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">All doors</h1>
          <p className="text-muted-foreground text-sm">{doors.length} results</p>
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-3 border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5 min-w-[220px]">
          <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="q">Search</label>
          <Input id="q" name="q" defaultValue={search} placeholder="Title, author…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="size">Size</label>
          <select id="size" name="size" defaultValue={size ?? ''} className="border-input h-9 border bg-muted px-2 text-sm">
            <option value="">All</option>
            {sizes.map((s) => (
              <option key={s.size} value={s.size}>{s.size}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="deleted" value="1" defaultChecked={includeDeleted} />
          Include deleted
        </label>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-widest uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3 w-20">Thumb</th>
              <th className="text-left p-3">Title</th>
              <th className="text-left p-3">Author</th>
              <th className="text-left p-3">Size</th>
              <th className="text-left p-3">Uploaded</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {doors.map((door) => (
              <tr key={door.id} className={door.deleted_at ? 'opacity-50' : ''}>
                <td className="p-3">
                  {door.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={door.thumbnail_url} alt="" className="w-16 h-9 object-cover border border-border" />
                  ) : <div className="w-16 h-9 bg-muted" />}
                </td>
                <td className="p-3">
                  <Link href={`/view/${door.id}`} className="hover:text-primary">{door.title}</Link>
                  {door.deleted_at && <span className="ml-2 text-xs text-destructive uppercase">Deleted</span>}
                </td>
                <td className="p-3 text-muted-foreground">{door.author}</td>
                <td className="p-3">{door.door_size}</td>
                <td className="p-3 text-muted-foreground text-xs tabular-nums">
                  {new Date(door.created_at).toISOString().slice(0, 10)}
                </td>
                <td className="p-3">
                  <DoorRowActions doorId={door.id} deleted={!!door.deleted_at} />
                </td>
              </tr>
            ))}
            {doors.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No doors match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
