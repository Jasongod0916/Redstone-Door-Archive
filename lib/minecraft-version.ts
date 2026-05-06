const JAVA_DATA_VERSION_TO_RELEASE: Record<number, string> = {
  2566: '1.16',
  2567: '1.16.1',
  2578: '1.16.2',
  2580: '1.16.3',
  2584: '1.16.4',
  2586: '1.16.5',
  2724: '1.17',
  2730: '1.17.1',
  2860: '1.18',
  2865: '1.18.1',
  2975: '1.18.2',
  3105: '1.19',
  3117: '1.19.1',
  3120: '1.19.2',
  3218: '1.19.3',
  3337: '1.19.4',
  3463: '1.20',
  3465: '1.20.1',
  3578: '1.20.2',
  3698: '1.20.3',
  3700: '1.20.4',
  3837: '1.20.5',
}

const SEMVERISH_VERSION = /^\d+(?:\.\d+){1,3}$/
const INTEGER_STRING = /^\d+$/

export function normalizeMinecraftVersion(
  value: null | string | undefined,
): null | string {
  if (!value) return null

  const trimmed = value.trim()
  if (trimmed === '') return null
  if (SEMVERISH_VERSION.test(trimmed)) return trimmed
  if (!INTEGER_STRING.test(trimmed)) return trimmed

  const mapped = JAVA_DATA_VERSION_TO_RELEASE[Number.parseInt(trimmed, 10)]
  return mapped ?? null
}
