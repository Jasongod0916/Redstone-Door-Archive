import Link from 'next/link'
import { listAdminDoors, listAdminEmails } from '@/lib/admin/queries'
import { TrashRowActions } from '@/components/admin/trash-row-actions'

export default async function AdminTrashPage() {
  const [doors, admins] = await Promise.all([
    listAdminDoors({ onlyDeleted: true }),
    listAdminEmails(),
  ])
  const emailByUserId = new Map(admins.map((a) => [a.user_id, a.email ?? '—']))

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-muted-foreground text-sm">{doors.length} items</p>
      </header>

      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-widest uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Title</th>
              <th className="text-left p-3">Author</th>
              <th className="text-left p-3">Size</th>
              <th className="text-left p-3">Deleted at</th>
              <th className="text-left p-3">Deleted by</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {doors.map((d) => (
              <tr key={d.id}>
                <td className="p-3"><Link href={`/view/${d.id}`} className="hover:text-primary">{d.title}</Link></td>
                <td className="p-3 text-muted-foreground">{d.author}</td>
                <td className="p-3">{d.door_size}</td>
                <td className="p-3 text-muted-foreground text-xs tabular-nums">
                  {d.deleted_at ? new Date(d.deleted_at).toISOString().slice(0, 19).replace('T', ' ') : '—'}
                </td>
                <td className="p-3 text-muted-foreground">{d.deleted_by ? (emailByUserId.get(d.deleted_by) ?? d.deleted_by) : '—'}</td>
                <td className="p-3"><TrashRowActions doorId={d.id} /></td>
              </tr>
            ))}
            {doors.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Trash is empty.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
