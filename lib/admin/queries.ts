import { createClient } from '@/lib/supabase/server'
import type { Door } from '@/lib/types/door'

export type AdminDoorRow = Door & {
  deleted_at: string | null
  deleted_by: string | null
}

export type ListAdminDoorsOptions = {
  search?: string
  size?: string
  includeDeleted?: boolean
  onlyDeleted?: boolean
}

export async function listAdminDoors(opts: ListAdminDoorsOptions = {}): Promise<AdminDoorRow[]> {
  const supabase = await createClient()
  let q = supabase.from('doors').select('*')

  if (opts.onlyDeleted) {
    q = q.not('deleted_at', 'is', null)
  } else if (!opts.includeDeleted) {
    q = q.is('deleted_at', null)
  }

  if (opts.size) q = q.eq('door_size', opts.size)

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.or(`title.ilike.${term},author.ilike.${term}`)
  }

  q = q.order('created_at', { ascending: false })

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as AdminDoorRow[]
}

export async function getAdminDoor(id: string): Promise<AdminDoorRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*, door_files(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as AdminDoorRow | null) ?? null
}

export type AdminAuditRow = {
  id: string
  actor_id: string
  actor_email: string | null
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export type ListAuditLogOptions = {
  action?: string
  actorId?: string
  limit?: number
  beforeCreatedAt?: string
}

export async function listAuditLog(opts: ListAuditLogOptions = {}): Promise<AdminAuditRow[]> {
  const supabase = await createClient()
  // Admin email view exposes (user_id, email) to admin callers.
  const { data: emailRows } = await supabase.from('admin_users_with_email').select('user_id, email')
  const emailByUserId = new Map<string, string>()
  for (const row of emailRows ?? []) {
    if (row.user_id && row.email) emailByUserId.set(row.user_id, row.email)
  }

  let q = supabase.from('admin_audit_log').select('*')
  if (opts.action) q = q.eq('action', opts.action)
  if (opts.actorId) q = q.eq('actor_id', opts.actorId)
  if (opts.beforeCreatedAt) q = q.lt('created_at', opts.beforeCreatedAt)
  q = q.order('created_at', { ascending: false }).limit(opts.limit ?? 50)

  const { data, error } = await q
  if (error) throw error

  return (data ?? []).map((r) => ({
    id: r.id,
    actor_id: r.actor_id,
    actor_email: emailByUserId.get(r.actor_id) ?? null,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    details: (r.details ?? {}) as Record<string, unknown>,
    created_at: r.created_at,
  }))
}

export type DashboardStats = {
  totalLive: number
  totalAll: number
  uploadsLast7Days: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [live, all, recent] = await Promise.all([
    supabase.from('doors').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('doors').select('id', { count: 'exact', head: true }),
    supabase
      .from('doors')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),
  ])

  return {
    totalLive: live.count ?? 0,
    totalAll: all.count ?? 0,
    uploadsLast7Days: recent.count ?? 0,
  }
}

export async function listAdminEmails(): Promise<Array<{ user_id: string; email: string | null }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('admin_users_with_email')
    .select('user_id, email')
  if (error) throw error
  return (data ?? []) as Array<{ user_id: string; email: string | null }>
}
