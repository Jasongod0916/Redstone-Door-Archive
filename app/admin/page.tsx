import {
  getExtendedDashboardStats,
  getSizeDistribution,
  getTopUploaders,
  listAuditLog,
} from '@/lib/admin/queries'
import { formatBytes } from '@/lib/admin/format'

export default async function AdminDashboardPage() {
  const [stats, sizes, uploaders, recent] = await Promise.all([
    getExtendedDashboardStats(),
    getSizeDistribution(),
    getTopUploaders(5),
    listAuditLog({ limit: 10 }),
  ])

  const maxSize = sizes.reduce((m, s) => (s.count > m ? s.count : m), 0)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Admin dashboard</h1>
        <p className="text-muted-foreground text-sm">Catalog health + moderation overview.</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Live doors" value={stats.totalLive} />
        <Stat label="Including trash" value={stats.totalAll} />
        <Stat label="Last 7d uploads" value={stats.uploadsLast7Days} />
        <Stat label="Featured" value={stats.featuredCount} />
        <Stat label="Admins" value={stats.adminCount} />
        <Stat label="Users" value={stats.userCount} />
        <Stat label="Storage used" value={formatBytes(stats.storageBytes)} />
      </section>

      <section className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-xs tracking-widest uppercase text-muted-foreground">
          Size distribution
        </header>
        {sizes.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No data.</div>
        ) : (
          <ul className="flex flex-col gap-2 p-4">
            {sizes.map((s) => {
              const pct = maxSize === 0 ? 0 : Math.round((s.count / maxSize) * 100)
              return (
                <li
                  key={s.size}
                  className="grid grid-cols-[3rem_3rem_1fr] items-center gap-3 text-sm tabular-nums"
                >
                  <span className="text-foreground font-medium">{s.size}</span>
                  <span className="text-muted-foreground">{s.count}</span>
                  <div className="h-1.5 w-full bg-muted">
                    {s.count > 0 ? (
                      <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-xs tracking-widest uppercase text-muted-foreground">
          Top uploaders
        </header>
        {uploaders.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No uploaders yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs tracking-widest uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3 w-12">#</th>
                <th className="text-left p-3">Email</th>
                <th className="text-right p-3 w-20">Live</th>
                <th className="text-right p-3 w-20">Deleted</th>
                <th className="text-right p-3 w-20">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {uploaders.map((u, i) => (
                <tr key={u.user_id}>
                  <td className="p-3 text-muted-foreground">{i + 1}</td>
                  <td className="p-3">{u.email ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{u.live}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">{u.deleted}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{u.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
                <span className="text-muted-foreground tabular-nums">
                  {new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ')}
                </span>
                <span className="text-foreground">{r.actor_email ?? r.actor_id ?? <span className="italic text-muted-foreground">deleted user</span>}</span>
                <span className="text-primary">{r.action}</span>
                <span className="text-muted-foreground">
                  {r.target_type}:{r.target_id ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border bg-card p-4 flex flex-col gap-2">
      <span className="text-xs tracking-widest uppercase text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}
