import { hex } from './sprites'
import { BUBBLE_FONT, BUBBLE_LINE_H, type BubbleBox, type Box, type Canvas, type Hotspot, type Label } from './scene'

const UPPER_HALF = 0x2580
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  const out: string[] = []
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out.push(B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!)
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out.push(`${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}==`)
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out.push(`${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}${B64[(n >> 6) & 63]!}=`)
  }

  return out.join('')
}

/** A label's text centered in its width, one glyph per column, `perColumn` pixels to a column. */
function labelCells(labels: readonly Label[], columns: number, perColumn: number): Map<number, { ch: number; color: number }> {
  const cells = new Map<number, { ch: number; color: number }>()
  for (const label of labels) {
    const chars = Array.from(label.text)
    const left = Math.floor(label.x / perColumn) + Math.floor((label.width / perColumn - chars.length) / 2)
    const row = label.y >> 1
    chars.forEach((ch, i) => {
      const code = ch.codePointAt(0) ?? 32
      const isPrintable = code >= 32 && code <= 0xffff && code !== 0x7f
      cells.set(row * columns + left + i, { ch: isPrintable ? code : 0x3f, color: label.color })
    })
  }

  return cells
}

/** The quarter blocks by which of a cell's four pixels are foreground: 1 top left, 2 top right, 4 bottom left, 8 bottom right. */
const QUADRANTS = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588,
]

function distance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)

  return dr * dr + dg * dg + db * db
}

/**
 * One cell of 2x2 pixels as a quarter block: the two colors most of its
 * pixels have, every pixel drawn in the nearer of them (a cell paints two).
 */
export function quadrantCell(pixels: readonly [number, number, number, number]): { ch: number; fg: number; bg: number } {
  const counts = new Map<number, number>()
  for (const p of pixels) counts.set(p, (counts.get(p) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const bg = ranked[0]![0]
  const fg = ranked[1]?.[0] ?? bg
  let mask = 0
  pixels.forEach((p, i) => {
    if (p !== bg && distance(p, fg) < distance(p, bg)) mask |= 1 << i
  })

  return { ch: QUADRANTS[mask]!, fg, bg }
}

/**
 * The terminal's picture. Half blocks by default: every cell an upper half
 * block, its foreground the pixel above and its background the pixel below,
 * so pixels come out square. Quarter blocks with `isQuad`: 2x2 pixels a cell.
 */
export function rasterCells(
  canvas: Canvas,
  labels: readonly Label[],
  isQuad = false,
): { columns: number; rows: number; cells: string } {
  const perColumn = isQuad ? 2 : 1
  const columns = Math.ceil(canvas.width / perColumn)
  const rows = Math.ceil(canvas.height / 2)
  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  const text = labelCells(labels, columns, perColumn)
  const at = (x: number, y: number) => canvas.get(Math.min(x, canvas.width - 1), Math.min(y, canvas.height - 1))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col
      const glyph = text.get(index)
      const offset = index * 12
      let cell: { ch: number; fg: number; bg: number }
      if (isQuad) {
        const x = col * 2
        const y = row * 2
        cell = quadrantCell([at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)])
      } else {
        const top = at(col, row * 2)
        cell = { ch: UPPER_HALF, fg: top, bg: at(col, row * 2 + 1) }
      }
      if (glyph !== undefined) {
        // A name tag sits on the floor: the color most of the cell has.
        const floor = isQuad ? cell.bg : cell.fg
        cell = { ch: glyph.ch, fg: glyph.color, bg: floor }
      }
      view.setUint32(offset, cell.ch, true)
      view.setUint32(offset + 4, cell.fg, true)
      view.setUint32(offset + 8, cell.bg, true)
    }
  }

  return { columns, rows, cells: base64(bytes) }
}

/** Rectangles covering every pixel `colorAt` gives, runs merged down the rows, as one path per color. */
function paths(width: number, height: number, colorAt: (x: number, y: number) => number | undefined): string {
  type Run = { x: number; y: number; w: number; h: number; color: number }
  const done: Run[] = []
  let open = new Map<string, Run>()
  for (let y = 0; y < height; y++) {
    const next = new Map<string, Run>()
    let x = 0
    while (x < width) {
      const color = colorAt(x, y)
      if (color === undefined) {
        x++
        continue
      }
      let w = 1
      while (x + w < width && colorAt(x + w, y) === color) w++
      const key = `${x},${w},${color}`
      const run = open.get(key)
      if (run !== undefined) {
        run.h++
        open.delete(key)
        next.set(key, run)
      } else {
        next.set(key, { x, y, w, h: 1, color })
      }
      x += w
    }
    for (const run of open.values()) done.push(run)
    open = next
  }
  for (const run of open.values()) done.push(run)

  const byColor = new Map<number, string[]>()
  for (const run of done) {
    const list = byColor.get(run.color) ?? []
    list.push(`M${run.x} ${run.y}h${run.w}v${run.h}h-${run.w}z`)
    byColor.set(run.color, list)
  }

  return [...byColor].map(([color, d]) => `<path fill="${hex(color)}" d="${d.join('')}"/>`).join('')
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

const round = (v: number) => Math.round(v * 1000) / 1000

export type SvgBubble = BubbleBox & { lines: readonly string[] }
export type SvgExtras = { bubbles?: readonly SvgBubble[]; avatars?: readonly SvgAvatar[]; badges?: readonly SvgBadge[] }

const BUBBLE_FILL = '#f6f4f0'
const BUBBLE_INK = '#22252b'

/** Los bocadillos: un rectángulo redondeado, un pico hacia la cabeza y el texto centrado. */
function bubblesSvg(bubbles: readonly SvgBubble[]): string {
  if (bubbles.length === 0) return ''
  const body = bubbles
    .map(b => {
      const base = round(b.y + b.height - 0.2)
      const box = `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.width)}" height="${round(b.height)}" rx="1.6" fill="${BUBBLE_FILL}" stroke="${BUBBLE_INK}" stroke-width="0.35"/>`
      const tail = `<path d="M${round(b.tailX - 1.4)} ${base}L${round(b.tailX)} ${round(b.tailY)}L${round(b.tailX + 1.4)} ${base}Z" fill="${BUBBLE_FILL}"/>`
      const text = b.lines
        .map((line, i) => `<text x="${round(b.x + b.width / 2)}" y="${round(b.y + 1 + BUBBLE_LINE_H / 2 + i * BUBBLE_LINE_H)}">${escapeXml(line)}</text>`)
        .join('')
      return box + tail + text
    })
    .join('')

  return `<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="${BUBBLE_FONT}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${BUBBLE_INK}">${body}</g>`
}

export const SVG_LIMIT = 131072

/**
 * Ancho propio del SVG en escritorio y móvil: mayor que cualquier panel, para que
 * la app lo encaje al ancho del panel (sin `width` en el elemento, el dibujo toma
 * su propio ancho hasta el borde del hueco y el alto en proporción).
 */
export const FILL_WIDTH = 4000

/** La escala que da al dibujo `FILL_WIDTH` píxeles de ancho propio. */
export function fillScale(width: number): number {
  return FILL_WIDTH / width
}

/**
 * Cómo se colocan los PNG en el SVG: `use` (una copia por proyecto en <defs>) o
 * `inline` (cada mesa lleva la suya). Lo decidió la prueba de la tarea 2.
 */
export const AVATAR_MODE: 'use' | 'inline' = 'use'

export type SvgAvatar = Box & {
  seat: number
  /** Un id por proyecto: su raíz. */
  key: string
  /** Fotogramas en base64. */
  frames: readonly string[]
  imageWidth: number
  imageHeight: number
  fps: number
}
export type SvgBadge = { x: number; y: number; text: string; color: string }

const pngImage = (a: SvgAvatar, data: string, attrs: string) =>
  `<image${attrs} width="${a.imageWidth}" height="${a.imageHeight}" href="data:image/png;base64,${data}" style="image-rendering:pixelated"/>`

/** Los avatares: escalados a su hueco, apoyados abajo y centrados; los animados alternan fotogramas con SMIL. */
function avatarLayer(avatars: readonly SvgAvatar[]): { defs: string; body: string } {
  const keys = new Map<string, number>()
  let defs = ''
  let body = ''
  for (const a of avatars) {
    if (!keys.has(a.key)) {
      const fresh = keys.size
      keys.set(a.key, fresh)
      if (AVATAR_MODE === 'use') a.frames.forEach((data, f) => (defs += pngImage(a, data, ` id="av${fresh}f${f}"`)))
    }
    const k = keys.get(a.key)!
    const scale = Math.min(a.width / a.imageWidth, a.height / a.imageHeight)
    const x = round(a.x + (a.width - a.imageWidth * scale) / 2)
    const y = round(a.y + a.height - a.imageHeight * scale)
    const dur = (a.frames.length / a.fps).toFixed(2)
    const shapes = a.frames.map((data, f) => {
      const shape = AVATAR_MODE === 'use' ? `<use href="#av${k}f${f}"/>` : pngImage(a, data, '')
      if (a.frames.length === 1) return shape
      const values = a.frames.map((_, i) => (i === f ? 'visible' : 'hidden')).join(';')
      return `<g visibility="${f === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" values="${values}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>${shape}</g>`
    })
    body += `<g transform="translate(${x} ${y}) scale(${round(scale)})">${shapes.join('')}</g>`
  }
  return { defs: defs === '' ? '' : `<defs>${defs}</defs>`, body }
}

function badgeLayer(badges: readonly SvgBadge[]): string {
  if (badges.length === 0) return ''
  const body = badges
    .map(b => `<text x="${round(b.x)}" y="${round(b.y)}" fill="${b.color}" stroke="${BUBBLE_INK}" stroke-width="0.4" paint-order="stroke">${escapeXml(b.text)}</text>`)
    .join('')
  return `<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="5" font-weight="700" text-anchor="middle" dominant-baseline="middle">${body}</g>`
}

/** El primer SVG que cabe: con todos los fotogramas de los avatares, con solo el primero, o sin avatares (spec 3.4). */
export function fitAvatars(avatars: readonly SvgAvatar[], build: (avatars: readonly SvgAvatar[]) => string): string {
  const attempts = [avatars, avatars.map(a => ({ ...a, frames: a.frames.slice(0, 1) })), []]
  for (const attempt of attempts) {
    const svg = build(attempt)
    if (svg.length <= SVG_LIMIT) return svg
  }
  return build([])
}

/** The color most pixels have, painted once as the backdrop. */
function commonest(canvas: Canvas): number {
  const counts = new Map<number, number>()
  let best = canvas.px[0] ?? 0
  let bestCount = 0
  for (const color of canvas.px) {
    const n = (counts.get(color) ?? 0) + 1
    counts.set(color, n)
    if (n > bestCount) {
      best = color
      bestCount = n
    }
  }

  return best
}

/**
 * The remote surfaces' picture: the first frame whole, and for each later
 * frame only the pixels that change, shown in turn by SMIL so it plays with
 * no redraw. Falls back to fewer frames, then one, past the size limit.
 */
export function sceneSvg(
  frames: readonly Canvas[],
  labels: readonly Label[],
  hotspots: readonly Hotspot[],
  options: { scale: number; secondsPerFrame: number },
  extras: SvgExtras = {},
): string {
  const first = frames[0]!
  const { width, height } = first
  const backdrop = commonest(first)
  const base = paths(width, height, (x, y) => {
    const color = first.get(x, y)
    return color === backdrop ? undefined : color
  })
  const texts = labels
    .map(label => {
      const x = label.x + label.width / 2
      return `<text x="${x}" y="${label.y + 1.6}" fill="${hex(label.color)}">${escapeXml(label.text)}</text>`
    })
    .join('')
  const spots = hotspots
    .map(
      spot =>
        `<rect x="${spot.x}" y="${spot.y}" width="${spot.width}" height="${spot.height}" fill="#000" fill-opacity="0" pointer-events="all"><title>${escapeXml(spot.title)}</title></rect>`,
    )
    .join('')
  const avatar = avatarLayer(extras.avatars ?? [])
  const top = avatar.body + badgeLayer(extras.badges ?? [])
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${round(width * options.scale)}" height="${round(height * options.scale)}">` +
    avatar.defs +
    `<rect width="${width}" height="${height}" fill="${hex(backdrop)}"/>` +
    `<g shape-rendering="crispEdges">${base}</g>`
  const tail =
    `<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="3.4" font-weight="700" text-anchor="middle" dominant-baseline="middle">${texts}</g>` +
    bubblesSvg(extras.bubbles ?? []) +
    `${spots}</svg>`

  const build = (step: number) => {
    const shown = frames.filter((_, i) => i % step === 0)
    if (shown.length < 2) return head + top + tail
    const dur = (frames.length * options.secondsPerFrame).toFixed(2)
    const overlays = shown.slice(1).map((frame, k) => {
      const diff = paths(width, height, (x, y) => {
        const color = frame.get(x, y)
        return color === first.get(x, y) ? undefined : color
      })
      if (diff === '') return ''
      const values = shown.map((_, i) => (i === k + 1 ? 'visible' : 'hidden')).join(';')
      return `<g visibility="hidden" shape-rendering="crispEdges"><animate attributeName="visibility" values="${values}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>${diff}</g>`
    })

    return head + overlays.join('') + top + tail
  }

  for (const step of [1, 2, 4, frames.length]) {
    const svg = build(step)
    if (svg.length <= SVG_LIMIT) return svg
  }

  return head + top + tail
}
