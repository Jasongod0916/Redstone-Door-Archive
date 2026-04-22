export type DoorFileFormat = 'litematic' | 'schem' | 'mcstructure' | 'schematic' | 'nbt'

export type DoorFile = {
  id: string
  door_id: string
  format: DoorFileFormat
  storage_path: string
  file_name: string
  file_size: number | null
  created_at: string
}

export type Door = {
  id: string
  slug: string
  title: string
  author: string
  description: string | null
  minecraft_version: string | null
  door_size: string
  tags: string[]
  block_count: number | null
  bounds_width: number | null
  bounds_height: number | null
  bounds_depth: number | null
  open_ticks: number | null
  close_ticks: number | null
  total_ticks: number | null
  video_url: string | null
  thumbnail_url: string | null
  sort_order: number
  is_featured: boolean
  created_at: string
  updated_at: string
}

export type DoorWithFiles = Door & { door_files: DoorFile[] }
