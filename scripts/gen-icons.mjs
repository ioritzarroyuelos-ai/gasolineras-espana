// Genera los PNG derivados del SVG de marca.
//
// Entrada:
//   public/static/favicon.svg  -> icono cuadrado
//   public/static/og.svg       -> imagen social 1200x630
//
// Salida (idempotente, sobrescribe si ya existen):
//   public/static/apple-touch-icon.png  (180x180)  Safari iOS
//   public/static/icon-192.png          (192x192)  manifest + Android
//   public/static/icon-512.png          (512x512)  manifest + splash Android
//   public/static/favicon-32.png        (32x32)    fallback legacy browsers
//   public/static/og.png                (1200x630) OG / Twitter / LinkedIn
//
// Se ejecuta como pre-build (npm run build ejecuta primero "icons").
// Usa @resvg/resvg-js (Rust via node-bindings, sin dependencias nativas del sistema).

import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = resolve(__dirname, '..', 'public', 'static')

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function renderSquare(svgPath, outPath, size) {
  const svg = readFileSync(svgPath, 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: false },
  })
  const png = resvg.render().asPng()
  writeFileSync(outPath, png)
  return png.length
}

function renderWithWidth(svgPath, outPath, width) {
  const svg = readFileSync(svgPath, 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: '#14532d',
    font: { loadSystemFonts: false },
  })
  const png = resvg.render().asPng()
  writeFileSync(outPath, png)
  return png.length
}

function fmt(n) { return (n / 1024).toFixed(1) + ' kB' }

async function main() {
  ensureDir(STATIC_DIR)
  const favSvg = join(STATIC_DIR, 'favicon.svg')
  const ogSvg  = join(STATIC_DIR, 'og.svg')

  if (!existsSync(favSvg)) { console.error('missing', favSvg); process.exit(1) }
  if (!existsSync(ogSvg))  { console.error('missing', ogSvg);  process.exit(1) }

  const outputs = [
    { out: 'favicon-32.png',       size:  32,  from: favSvg, kind: 'square' },
    { out: 'apple-touch-icon.png', size: 180, from: favSvg, kind: 'square' },
    { out: 'icon-192.png',         size: 192, from: favSvg, kind: 'square' },
    { out: 'icon-512.png',         size: 512, from: favSvg, kind: 'square' },
    { out: 'og.png',               size: 1200, from: ogSvg, kind: 'wide' },
  ]

  for (const o of outputs) {
    const outPath = join(STATIC_DIR, o.out)
    const bytes = o.kind === 'wide'
      ? renderWithWidth(o.from, outPath, o.size)
      : renderSquare(o.from, outPath, o.size)
    console.log(`  ${o.out.padEnd(24)} ${o.size}px  ${fmt(bytes).padStart(9)}`)
  }
  console.log('icons OK')
}

main().catch(err => { console.error(err); process.exit(1) })
