// Exporta arquitectura.svg a PNG con sharp, que ya está entre las dependencias del frontend.
//
//     node docs/diagrams/render.mjs
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '../../frontend/package.json'))
const sharp = require('sharp')

const svg = join(here, 'arquitectura.svg')
const png = join(here, 'arquitectura.png')
await sharp(svg, { density: 144 }).png().toFile(png)
console.log(png)
