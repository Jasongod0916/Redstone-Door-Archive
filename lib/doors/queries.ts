import { createClient } from '@/lib/supabase/server'
import type { Door } from '@/lib/types/door'

export type DoorsListOptions = {
  width?: number
  height?: number
  sort?: 'recent' | 'blocks' | 'ticks'
  search?: string
}

export async function listDoors(opts: DoorsListOptions = {}): Promise<Door[]> {
  const supabase = await createClient()
  let q = supabase.from('doors').select('*')

  if (typeof opts.width === 'number') q = q.eq('door_width', opts.width)
  if (typeof opts.height === 'number') q = q.eq('door_height', opts.height)

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.or(`title.ilike.${term},author.ilike.${term},description.ilike.${term}`)
  }

  switch (opts.sort) {
    case 'blocks':
      q = q.order('non_air_blocks', { ascending: true, nullsFirst: false })
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
  return (data ?? []) as Door[]
}

export async function getDoor(id: string): Promise<Door | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('doors').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Door | null) ?? null
}

export async function listAvailableSizes(): Promise<Array<{ w: number; h: number; count: number }>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('doors').select('door_width, door_height')
  if (error) throw error
  const map = new Map<string, { w: number; h: number; count: number }>()
  for (const row of data ?? []) {
    const key = `${row.door_width}x${row.door_height}`
    const current = map.get(key) ?? { w: row.door_width, h: row.door_height, count: 0 }
    current.count += 1
    map.set(key, current)
  }
  return Array.from(map.values()).sort((a, b) => a.w - b.w || a.h - b.h)
}
