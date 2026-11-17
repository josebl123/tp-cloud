#!/usr/bin/env node
/**
 * Fails when any colour pair the interface actually renders drops below WCAG AA.
 *
 * The palette was darkened once already because `faint` measured 2.59:1 and carried hints and
 * timestamps - it read as "quiet" on a good screen and as "missing" to everyone else. Recovering
 * some of that vividness later is fine; recovering it by accident, without measuring, is how the
 * first problem happened. So the tokens are read straight from globals.css and every pair below is
 * one that some component really produces, not an invented matrix.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'globals.css')
const AA = 4.5

/** Pairs the components actually render. Sources: ui/Alert.tsx, ui/Badge.tsx, ui/Button.tsx. */
const GROUNDS = ['bg', 'surface', 'raised']
const ON_EVERY_GROUND = ['ink', 'muted', 'faint', 'brand', 'sage', 'warn', 'danger']
const PAIRS = [
  ['bg', 'ink'],               // primary button label
  ['on-brand', 'brand'],        // selected range
  ['on-brand', 'brand-hover'],
  ['brand', 'brand-soft'],      // Badge kind="brand"
  ['sage', 'sage-soft'],        // Badge/Alert success
  ['warn', 'warn-soft'],        // Badge/Alert warn
  ['danger', 'danger-soft'],    // Badge/Alert error
  ['muted', 'raised'],          // Badge neutral, Alert info
]

const channel = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const luminance = (hex) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/**
 * Dark mode re-points the same token names, so the two themes are read as two separate maps: the
 * `@theme` block, then that map overlaid with whatever the dark block redefines.
 */
function palettes(css) {
  const read = (block) =>
    Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('prefers-color-scheme'))
  const dark = css.slice(css.indexOf('prefers-color-scheme'))
  const light = read(theme)
  return { light, dark: { ...light, ...read(dark) } }
}

const { light, dark } = palettes(readFileSync(CSS, 'utf8'))
let failed = 0

for (const [theme, palette] of [['light', light], ['dark', dark]]) {
  const checks = [
    ...ON_EVERY_GROUND.flatMap((fg) => GROUNDS.map((bg) => [fg, bg])),
    ...PAIRS,
  ]
  console.log(`\n${theme.toUpperCase()}`)
  for (const [fg, bg] of checks) {
    if (!palette[fg] || !palette[bg]) {
      console.log(`  ?  ${fg} on ${bg} - token missing`)
      failed++
      continue
    }
    const r = contrast(palette[fg], palette[bg])
    const ok = r >= AA
    if (!ok) failed++
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${`${fg} on ${bg}`.padEnd(26)} ${r.toFixed(2).padStart(5)}  ` +
        `${palette[fg]} / ${palette[bg]}`,
    )
  }
}

console.log(
  failed === 0
    ? `\nAll pairs clear ${AA}:1.`
    : `\n${failed} pair${failed === 1 ? '' : 's'} below ${AA}:1.`,
)
process.exit(failed === 0 ? 0 : 1)
