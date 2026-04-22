'use client'

import { useState } from 'react'

export function AuditDetails({ details }: { details: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(details)
  if (keys.length === 0) return <span className="text-muted-foreground">—</span>

  return (
    <div>
      <button
        type="button"
        className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : `Show (${keys.length})`}
      </button>
      {open && (
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words border border-border bg-muted p-2 text-xs">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  )
}
