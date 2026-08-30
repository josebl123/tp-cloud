import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Logo />
        <Link href="/login">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center py-16">
        <p className="text-sm font-medium text-brand">Queue management</p>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,8vw,4rem)] leading-[0.95] font-semibold tracking-tight">
          Waiting,
          <br />
          without the line.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Your customers scan a QR code, take their place, and follow their turn from their phone.
          No app to install, no paper tickets, no one hovering by the door.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register">
            <Button size="lg">Set up your first queue</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary">
              I already have an account
            </Button>
          </Link>
        </div>

        <dl className="mt-16 grid gap-6 sm:grid-cols-3">
          {[
            {
              term: 'For the customer',
              detail: 'Live position, people ahead, and a realistic wait — updated the moment the line moves.',
            },
            {
              term: 'For your staff',
              detail: 'One board to call, serve, pause and reseat, with every action on the record.',
            },
            {
              term: 'For the no-shows',
              detail: 'A grace period you set, and a policy that decides what happens when it runs out.',
            },
          ].map((item) => (
            <div key={item.term}>
              <dt className="font-display text-base font-semibold">{item.term}</dt>
              <dd className="mt-1.5 text-sm text-muted">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <footer className="border-t border-line pt-6 text-xs text-faint">
        ITBA 82.08 Cloud Computing · Grupo 9
      </footer>
    </main>
  )
}
