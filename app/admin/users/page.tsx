import { requireAdmin } from '@/lib/admin/guard'
import { listUsersWithStats } from '@/lib/admin/queries'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UserRowActions } from '@/components/admin/user-row-actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const ROLE_OPTIONS: Array<{ value: 'all' | 'admins' | 'non_admins'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'admins', label: 'Admins' },
  { value: 'non_admins', label: 'Non-admins' },
]

function fmt(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin()
  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q : ''
  const roleParam = typeof params.role === 'string' ? params.role : 'all'
  const role = (ROLE_OPTIONS.find((r) => r.value === roleParam)?.value ?? 'all') as
    | 'all' | 'admins' | 'non_admins'

  const users = await listUsersWithStats({
    search: search || undefined,
    role,
  })

  const adminCount = users.filter((u) => u.is_admin).length

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">{users.length} results · {adminCount} admin{adminCount === 1 ? '' : 's'}</p>
      </header>

      <form className="flex flex-wrap items-end gap-3 border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5 min-w-[220px]">
          <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="q">Search email</label>
          <Input id="q" name="q" defaultValue={search} placeholder="email…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue={role} className="border-input h-9 border bg-muted px-2 text-sm">
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-widest uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Joined</th>
              <th className="text-left p-3">Last sign-in</th>
              <th className="text-left p-3">Live doors</th>
              <th className="text-left p-3">Deleted</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.user_id}>
                <td className="p-3">{u.email ?? '—'}</td>
                <td className="p-3 text-muted-foreground text-xs tabular-nums">{fmt(u.created_at)}</td>
                <td className="p-3 text-muted-foreground text-xs tabular-nums">{fmt(u.last_sign_in_at)}</td>
                <td className="p-3 tabular-nums">{u.live_doors}</td>
                <td className="p-3 tabular-nums text-muted-foreground">{u.deleted_doors}</td>
                <td className="p-3">
                  {u.is_admin ? (
                    <Badge className="border-primary/30 bg-primary/10 text-primary">Admin</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">User</Badge>
                  )}
                </td>
                <td className="p-3">
                  <UserRowActions
                    targetUserId={u.user_id}
                    targetEmail={u.email ?? u.user_id}
                    isAdmin={u.is_admin}
                    isSelf={u.user_id === actor.id}
                    isLastAdmin={u.is_admin && adminCount === 1}
                  />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No users match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
