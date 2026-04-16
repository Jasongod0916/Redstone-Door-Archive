export type DoorFileKey = 'litematic' | 'schem' | 'mcstructure'

export type DoorFiles = Partial<Record<DoorFileKey, string | null>>

export type Door = {
  id: string
  title: string
  author: string
  description: string | null
  minecraft_version: string | null
  door_width: number
  door_height: number
  non_air_blocks: number | null
  bbox_w: number | null
  bbox_h: number | null
  bbox_d: number | null
  open_ticks: number | null
  close_ticks: number | null
  total_ticks: number | null
  video_url: string | null
  tags: string[]
  files: DoorFiles
  owner_id: string | null
  created_at: string
  updated_at: string
}

export type DoorInsert = Omit<Door, 'created_at' | 'updated_at'>

export const doorSizeLabel = (w: number, h: number) => `${w}x${h}`
