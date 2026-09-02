import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { AuthProvider } from '@/lib/auth'
import { I18nProvider } from '@/lib/i18n'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Q — skip the line, not your turn', template: '%s · Q' },
  description:
    'Scan a QR code, take your place in the queue, and follow your turn from your phone instead of standing in line.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfbf7' },
    { media: '(prefers-color-scheme: dark)', color: '#17120f' },
  ],
  width: 'device-width',
  initialScale: 1,
  // The customer view is read outdoors and one-handed; let people zoom.
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh antialiased">
        <I18nProvider>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
