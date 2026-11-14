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

/**
 * The Content Security Policy: what the page may load and where it may connect. A static export has
 * no server to send it as a header, so it goes as a <meta> tag. Inline scripts have to be allowed:
 * Next inlines its bootstrap scripts at build time, and a nonce needs a server per request. What the
 * policy does restrict: scripts, styles, fonts and images only from the site itself, and connections
 * only to the site, Cognito and the WebSocket API. Framing is forbidden by the X-Frame-Options header,
 * since `frame-ancestors` does not work in a <meta>. Development needs `eval` for hot reload, so the
 * policy only applies to the production build.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://*.amazonaws.com wss://*.amazonaws.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ')

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      {process.env.NODE_ENV === 'production' ? (
        <head>
          <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />
        </head>
      ) : null}
      <body className="min-h-dvh antialiased">
        <I18nProvider>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
