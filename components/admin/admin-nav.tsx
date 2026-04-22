'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  disabled?: boolean
  phase?: string
}

const ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/doors', label: 'Doors' },
  { href: '/admin/trash', label: 'Trash' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/storage', label: 'Storage' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/curation', label: 'Curation' },
]

export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="text-muted-foreground text-xs tracking-widest uppercase mb-2">Admin</div>
      {ITEMS.map((item) => {
        const active = !item.disabled && (pathname === item.href || pathname.startsWith(`${item.href}/`))
        if (item.disabled) {
          return (
            <div
              key={item.label}
              className="flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground/50 cursor-not-allowed select-none"
            >
              <span>{item.label}</span>
              <span className="text-[10px]">{item.phase}</span>
            </div>
          )
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'px-3 py-2 text-xs uppercase tracking-widest border border-transparent transition-colors',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
