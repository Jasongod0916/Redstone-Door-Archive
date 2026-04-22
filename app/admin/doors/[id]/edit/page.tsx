import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminDoor } from '@/lib/admin/queries'
import { DoorEditForm } from '@/components/admin/door-edit-form'

export default async function AdminDoorEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const door = await getAdminDoor(id)
  if (!door) notFound()
  const doorWithOwner = door as typeof door & { owner_id?: string | null }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit door</h1>
          <p className="text-muted-foreground text-sm">
            <Link className="hover:text-primary" href={`/view/${door.id}`}>View public page ↗</Link>
          </p>
        </div>
        <Link href="/admin/doors" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Back to list
        </Link>
      </header>

      <section className="border border-border bg-card p-4 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
        <span>Owner ID: <code className="text-foreground">{doorWithOwner.owner_id ?? '—'}</code></span>
        <span>Thumbnail: <code className="text-foreground">{door.thumbnail_url ? 'set' : 'none'}</code></span>
        <span className="text-destructive">File attachments are not admin-editable by design.</span>
      </section>

      <DoorEditForm door={door} />
    </div>
  )
}
