import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInAction, signUpAction } from '@/app/auth/actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const notice = typeof params.notice === 'string' ? params.notice : null
  const next = typeof params.next === 'string' ? params.next : '/'

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">Redstone Door Archive</p>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          Browsing is open to everyone. Sign in to upload or edit a build.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-sm border border-border bg-muted px-3 py-2 text-sm">{notice}</p>
      ) : null}

      <form className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" minLength={6} required />
        </div>
        <div className="flex gap-2">
          <Button type="submit" formAction={signInAction} className="flex-1">
            Sign in
          </Button>
          <Button type="submit" formAction={signUpAction} variant="outline" className="flex-1">
            Create account
          </Button>
        </div>
      </form>

      <p className="text-muted-foreground text-xs">
        <Link href="/" className="underline underline-offset-4">
          Back to catalog
        </Link>
      </p>
    </main>
  )
}
