type ParsedDoorSize = {
  raw: string
  width: number | null
  height: number | null
}

const DOOR_SIZE_PATTERN = /^(\d+)\s*x\s*(\d+)$/i

export function parseDoorSize(size: string): ParsedDoorSize {
  const raw = size.trim()
  const match = raw.match(DOOR_SIZE_PATTERN)
  if (!match) {
    return { raw, width: null, height: null }
  }

  return {
    raw,
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  }
}

export function compareDoorSizes(a: string, b: string): number {
  const left = parseDoorSize(a)
  const right = parseDoorSize(b)

  if (left.width != null && right.width != null && left.height != null && right.height != null) {
    return left.width - right.width || left.height - right.height
  }

  if (left.width != null) return -1
  if (right.width != null) return 1

  return left.raw.localeCompare(right.raw, undefined, { numeric: true, sensitivity: 'base' })
}
