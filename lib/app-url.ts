function normalizeUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function getAppUrl(): string {
  const configured = process.env.APP_URL?.trim()
  if (configured) return normalizeUrl(configured)

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000'
  }

  throw new Error('APP_URL is required in production.')
}
