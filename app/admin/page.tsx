import { getDashboardStats, listAuditLog } from '@/lib/admin/queries'

export default async function AdminDashboardPage() {
  const [stats, recent] = await Promise.all([
    getDashboardStats(),
    listAuditLog({ limit: 10 }),
  ])

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Admin dashboard</h1>
        <p className="text-muted-foreground text-sm">Content moderation overview.</p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Live doors" value={stats.totalLive} />
        <Stat label="Including trash" value={stats.totalAll} />
        <Stat label="Last 7 days uploads" value={stats.uploadsLast7Days} />
      </section>

      <section className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-xs tracking-widest uppercase text-muted-foreground">
          Recent activity
        </header>
        {recent.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No admin activity yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-muted-foreground tabular-nums">{new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ')}</span>
                <span className="text-foreground">{r.actor_email ?? r.actor_id}</span>
                <span className="text-primary">{r.action}</span>
                <span className="text-muted-foreground">{r.target_type}:{r.target_id ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-card p-4 flex flex-col gap-2">
      <span className="text-xs tracking-widest uppercase text-muted-foreground">{label}</span>
      <span className="text-4xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}
