import type { DoorFile, DoorFileFormat } from '@/lib/types/door'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

export const FORMAT_PREFERENCE: DoorFileFormat[] = [
  'litematic',
  'schem',
  'mcstructure',
  'schematic',
  'nbt',
]

export type ResolvedDoorFile = Pick<DoorFile, 'id' | 'format' | 'file_name'> & {
  url: string
}

type DoorFilePreviewSource = Pick<DoorFile, 'id' | 'format' | 'storage_path' | 'file_name'>

export function schematicPublicUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/schematics/${storagePath}`
}

export function resolveDoorFiles(
  door: { door_files: DoorFilePreviewSource[] },
): ResolvedDoorFile[] {
  return door.door_files.map((file) => ({
    id: file.id,
    format: file.format,
    file_name: file.file_name,
    url: schematicPublicUrl(file.storage_path),
  }))
}

export function getPreferredDoorFile(
  door: { door_files: DoorFilePreviewSource[] },
): ResolvedDoorFile | null {
  const files = resolveDoorFiles(door)
  return FORMAT_PREFERENCE.map((fmt) => files.find((file) => file.format === fmt)).find(Boolean) ?? files[0] ?? null
}
