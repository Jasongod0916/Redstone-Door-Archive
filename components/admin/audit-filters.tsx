'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

const ACTIONS = [
  'door.update', 'door.soft_delete', 'door.restore', 'door.hard_delete', 'door.hard_delete_failed',
]

export function AuditFilters({ admins }: { admins: Array<{ user_id: string; email: string | null }> }) {
  const router = useRouter()
  const params = useSearchParams()

  function submit(form: FormData) {
    const next = new URLSearchParams()
    const action = String(form.get('action') ?? '')
    const actor = String(form.get('actor') ?? '')
    if (action) next.set('action', action)
    if (actor) next.set('actor', actor)
    router.push(`/admin/audit${next.size ? `?${next.toString()}` : ''}`)
  }

  return (
    <form
      action={submit}
      className="flex flex-wrap items-end gap-3 border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="action" className="text-xs tracking-widest uppercase text-muted-foreground">Action</label>
        <select id="action" name="action" defaultValue={params.get('action') ?? ''} className="border-input h-9 border bg-muted px-2 text-sm">
          <option value="">All</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="actor" className="text-xs tracking-widest uppercase text-muted-foreground">Actor</label>
        <select id="actor" name="actor" defaultValue={params.get('actor') ?? ''} className="border-input h-9 border bg-muted px-2 text-sm">
          <option value="">All</option>
          {admins.map((a) => <option key={a.user_id} value={a.user_id}>{a.email ?? a.user_id}</option>)}
        </select>
      </div>
      <Button type="submit" variant="outline" size="sm">Apply</Button>
    </form>
  )
}
