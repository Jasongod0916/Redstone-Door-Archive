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
  const email = typeof params.email === 'string' ? params.email : ''
  const mode = params.mode === 'signup' ? 'signup' : 'signin'
  const isSignUp = mode === 'signup'
  const switchMode = isSignUp ? 'signin' : 'signup'
  const switchHref = `/auth/login?mode=${switchMode}&next=${encodeURIComponent(next)}${
    email ? `&email=${encodeURIComponent(email)}` : ''
  }`

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-0">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">Redstone Door Archive</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {isSignUp ? 'Create account' : 'Sign in'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isSignUp
            ? 'Create an account to upload builds and manage your archive entries.'
            : 'Browsing is open to everyone. Sign in to upload or edit a build.'}
        </p>
      </header>

      <nav className="grid grid-cols-2 border border-border bg-background/60 p-1 text-sm">
        <AuthModeLink active={!isSignUp} href={`/auth/login?mode=signin&next=${encodeURIComponent(next)}`}>
          Sign in
        </AuthModeLink>
        <AuthModeLink active={isSignUp} href={`/auth/login?mode=signup&next=${encodeURIComponent(next)}`}>
          Create account
        </AuthModeLink>
      </nav>

      {error ? (
        <p role="alert" className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-sm border border-border bg-muted px-3 py-2 text-sm">{notice}</p>
      ) : null}

      <form action={isSignUp ? signUpAction : signInAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" defaultValue={email} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />
        </div>
        {isSignUp ? (
          <p className="text-muted-foreground text-xs leading-5">
            After creating an account, confirm the email we send you, then sign in here.
          </p>
        ) : null}
        <Button type="submit" className="w-full">
          {isSignUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="text-muted-foreground text-sm">
        {isSignUp ? 'Already have an account?' : 'New to the archive?'}{' '}
        <Link href={switchHref} className="text-foreground underline underline-offset-4 hover:text-primary">
          {isSignUp ? 'Sign in' : 'Create account'}
        </Link>
      </p>

      <p className="text-muted-foreground text-xs">
        <Link href="/" className="underline underline-offset-4">
          Back to catalog
        </Link>
      </p>
    </main>
  )
}

function AuthModeLink({
  active,
  href,
  children,
}: {
  active: boolean
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 text-center transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  )
}
