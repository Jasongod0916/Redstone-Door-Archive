import Link from 'next/link'
import { listAuditLog, listAdminEmails } from '@/lib/admin/queries'
import { AuditFilters } from '@/components/admin/audit-filters'
import { AuditDetails } from '@/components/admin/audit-details'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PAGE_SIZE = 50

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const action = typeof params.action === 'string' ? params.action : undefined
  const actorId = typeof params.actor === 'string' ? params.actor : undefined
  const cursor = typeof params.before === 'string' ? params.before : undefined

  const [rows, admins] = await Promise.all([
    listAuditLog({ action, actorId, beforeCreatedAt: cursor, limit: PAGE_SIZE }),
    listAdminEmails(),
  ])

  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1]?.created_at : null
  const nextParams = new URLSearchParams()
  if (action) nextParams.set('action', action)
  if (actorId) nextParams.set('actor', actorId)
  if (nextCursor) nextParams.set('before', nextCursor)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">{rows.length} rows on this page</p>
      </header>

      <AuditFilters admins={admins} />

      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-widest uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3 w-48">Time</th>
              <th className="text-left p-3 w-64">Actor</th>
              <th className="text-left p-3 w-48">Action</th>
              <th className="text-left p-3">Target</th>
              <th className="text-left p-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="p-3 text-xs tabular-nums text-muted-foreground">
                  {new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ')}
                </td>
                <td className="p-3 text-xs">{r.actor_email ?? r.actor_id ?? <span className="text-muted-foreground italic">deleted user</span>}</td>
                <td className="p-3"><span className="text-primary">{r.action}</span></td>
                <td className="p-3 text-xs">{r.target_type}: {r.target_id ? <Link href={`/admin/doors/${r.target_id}/edit`} className="underline hover:text-primary">{r.target_id}</Link> : '—'}</td>
                <td className="p-3"><AuditDetails details={r.details} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No audit entries match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        {nextCursor ? (
          <Link
            href={`/admin/audit?${nextParams.toString()}`}
            className="border border-border px-3 py-1.5 text-xs tracking-widest uppercase hover:border-primary/40 hover:text-primary"
          >
            Older →
          </Link>
        ) : null}
      </div>
    </div>
  )
}
