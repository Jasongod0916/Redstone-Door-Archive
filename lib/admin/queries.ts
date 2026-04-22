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

export type UserStats = {
  user_id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  banned_until: string | null
  live_doors: number
  deleted_doors: number
  is_admin: boolean
}

export type ListUsersWithStatsOptions = {
  search?: string
  role?: 'all' | 'admins' | 'non_admins'
}

export async function listUsersWithStats(
  opts: ListUsersWithStatsOptions = {},
): Promise<UserStats[]> {
  const supabase = await createClient()
  let q = supabase.from('admin_users_list').select('*')

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.ilike('email', term)
  }

  if (opts.role === 'admins') q = q.eq('is_admin', true)
  else if (opts.role === 'non_admins') q = q.eq('is_admin', false)

  q = q.order('created_at', { ascending: false })

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as UserStats[]
}

export type FeaturedDoorRow = AdminDoorRow

export async function listFeaturedForAdmin(): Promise<FeaturedDoorRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*')
    .eq('is_featured', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FeaturedDoorRow[]
}

export type ListAddableDoorsOptions = {
  search?: string
  limit?: number
}

export async function listAddableDoors(
  opts: ListAddableDoorsOptions = {},
): Promise<FeaturedDoorRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('doors')
    .select('*')
    .eq('is_featured', false)
    .is('deleted_at', null)

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.or(`title.ilike.${term},author.ilike.${term}`)
  }

  q = q.order('created_at', { ascending: false }).limit(opts.limit ?? 20)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as FeaturedDoorRow[]
}

export type ExtendedDashboardStats = DashboardStats & {
  featuredCount: number
  adminCount: number
  userCount: number
  storageBytes: number
}

export async function getExtendedDashboardStats(): Promise<ExtendedDashboardStats> {
  const supabase = await createClient()
  const base = await getDashboardStats()

  const [featured, admins, users, storageSum] = await Promise.all([
    supabase.from('doors').select('id', { count: 'exact', head: true })
      .eq('is_featured', true).is('deleted_at', null),
    supabase.from('admin_users').select('user_id', { count: 'exact', head: true }),
    supabase.from('admin_users_list').select('user_id', { count: 'exact', head: true }),
    supabase.from('door_files').select('file_size'),
  ])

  const bytes = (storageSum.data ?? []).reduce<number>((acc, row) => {
    const n = row.file_size as number | null | undefined
    return acc + (typeof n === 'number' ? n : 0)
  }, 0)

  return {
    ...base,
    featuredCount: featured.count ?? 0,
    adminCount: admins.count ?? 0,
    userCount: users.count ?? 0,
    storageBytes: bytes,
  }
}

export type SizeBucket = { size: string; count: number }

export async function getSizeDistribution(): Promise<SizeBucket[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('door_size')
    .is('deleted_at', null)
  if (error) throw error
  const map = new Map<string, number>()
  for (const row of data ?? []) {
    map.set(row.door_size, (map.get(row.door_size) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => {
      const [aw, ah] = a.size.split('x').map(Number)
      const [bw, bh] = b.size.split('x').map(Number)
      return aw - bw || ah - bh
    })
}

export type UploaderStats = {
  user_id: string
  email: string | null
  live: number
  deleted: number
  total: number
}

export async function getTopUploaders(limit = 5): Promise<UploaderStats[]> {
  const supabase = await createClient()
  // Pull every (user, door) pair we can see as an admin. Two separate queries
  // and an in-memory group-by keep us inside PostgREST's shape constraints —
  // we can't do filtered aggregates via the supabase-js builder directly.
  const [usersRes, doorsRes] = await Promise.all([
    supabase.from('admin_users_list').select('user_id, email'),
    supabase.from('doors').select('owner_id, deleted_at'),
  ])
  if (usersRes.error) throw usersRes.error
  if (doorsRes.error) throw doorsRes.error

  type Counts = { live: number; deleted: number; total: number }
  const counts = new Map<string, Counts>()
  for (const row of doorsRes.data ?? []) {
    const ownerId = row.owner_id as string | null
    if (!ownerId) continue
    const cur = counts.get(ownerId) ?? { live: 0, deleted: 0, total: 0 }
    cur.total += 1
    if (row.deleted_at == null) cur.live += 1
    else cur.deleted += 1
    counts.set(ownerId, cur)
  }

  const result: UploaderStats[] = []
  for (const u of usersRes.data ?? []) {
    const c = counts.get(u.user_id as string)
    if (!c || c.total === 0) continue
    result.push({
      user_id: u.user_id as string,
      email: (u.email as string | null) ?? null,
      live: c.live,
      deleted: c.deleted,
      total: c.total,
    })
  }

  result.sort((a, b) => b.total - a.total || b.live - a.live || (a.email ?? '').localeCompare(b.email ?? ''))
  return result.slice(0, limit)
}

export type StorageOrphan = {
  name: string
  size: number
  created_at: string
}

export async function listStorageOrphans(): Promise<StorageOrphan[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_storage_orphans')
  if (error) throw error
  return (data ?? []).map((r: { name: string; size: number | string; created_at: string }) => ({
    name: r.name,
    size: typeof r.size === 'string' ? Number.parseInt(r.size, 10) || 0 : r.size,
    created_at: r.created_at,
  }))
}
