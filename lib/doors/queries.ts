import { createClient } from '@/lib/supabase/server'
import { compareDoorSizes } from '@/lib/door-size'
import type { Door, DoorFile, DoorWithFiles } from '@/lib/types/door'

export type DoorsListOptions = {
  size?: string
  sort?: 'recent' | 'blocks' | 'ticks'
  search?: string
  excludeIds?: string[]
}

export type DoorCardRow = Door & {
  door_files: Pick<DoorFile, 'id' | 'format' | 'storage_path' | 'file_name'>[]
}

export async function listDoors(opts: DoorsListOptions = {}): Promise<DoorCardRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('doors')
    .select('*, door_files(id, format, storage_path, file_name)')

  if (opts.size) q = q.eq('door_size', opts.size)

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.or(`title.ilike.${term},author.ilike.${term},description.ilike.${term}`)
  }

  if (opts.excludeIds && opts.excludeIds.length > 0) {
    q = q.not('id', 'in', `(${opts.excludeIds.join(',')})`)
  }

  switch (opts.sort) {
    case 'blocks':
      q = q.order('block_count', { ascending: true, nullsFirst: false })
      break
    case 'ticks':
      q = q.order('total_ticks', { ascending: true, nullsFirst: false })
      break
    case 'recent':
    default:
      q = q.order('created_at', { ascending: false })
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DoorCardRow[]
}

export async function getDoor(id: string): Promise<DoorWithFiles | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*, door_files(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as DoorWithFiles | null) ?? null
}

export async function listAvailableSizes(): Promise<Array<{ size: string; count: number }>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('doors').select('door_size')
  if (error) throw error
  const map = new Map<string, number>()
  for (const row of data ?? []) {
    map.set(row.door_size, (map.get(row.door_size) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => compareDoorSizes(a.size, b.size))
}

export async function listFeaturedForPublic(): Promise<DoorCardRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*, door_files(id, format, storage_path, file_name)')
    .eq('is_featured', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DoorCardRow[]
}
