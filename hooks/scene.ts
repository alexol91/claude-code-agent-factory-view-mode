import type { AccessoryName, AgentSize, AgentStyle, FactoryAgent, HatName } from '../types'
import { tagOf } from './model'
import {
  ACCESSORIES,
  BANG,
  BIG_Z,
  CHECK,
  COLORS,
  HATS,
  ICONS,
  INK,
  SMALL_Z,
  shade,
  type Hat,
  type IconName,
  type Sprite,
} from './sprites'
import { drawFloorProps, drawWallProps } from './decor'
import { MINI_ACCESSORIES, MINI_BANG, MINI_BIG_Z, MINI_CHECK, MINI_HATS, MINI_ICONS, MINI_SMALL_Z } from './minis'
import { CHIPS, MEDIUM_ACCESSORIES, MEDIUM_HATS, SMALL_ACCESSORIES, SMALL_HATS } from './tinies'

/** A grid of opaque 0xRRGGBB pixels. */
export class Canvas {
  readonly px: Uint32Array

  constructor(
    readonly width: number,
    readonly height: number,
    fill = 0,
  ) {
    this.px = new Uint32Array(width * height).fill(fill)
  }

  get(x: number, y: number): number {
    return this.px[y * this.width + x] ?? 0
  }

  set(x: number, y: number, color: number): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      this.px[y * this.width + x] = color
    }
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.set(x + dx, y + dy, color)
      }
    }
  }

  /** Draws a sprite, each letter through `paint`; `.` and unknown letters are see-through. */
  sprite(x: number, y: number, rows: Sprite, paint: (ch: string) => number | undefined = ch => INK[ch]): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx]!
        const color = ch === '.' ? undefined : paint(ch)
        if (color !== undefined) {
          this.set(x + dx, y + dy, color)
        }
      }
    })
  }
}

/** Text laid over the picture: one glyph per pixel column, on an even pixel row. */
export type Label = { x: number; y: number; width: number; text: string; color: number }

/** A desk's rectangle, for the hover text the remote surfaces show. */
export type Hotspot = { x: number; y: number; width: number; height: number; title: string }

export type SceneAgent = { agent: FactoryAgent; style: AgentStyle }

/**
 * Which pictures: `full` for the scaled SVG; `large`, `medium` and `small`
 * for the terminal, where a pixel is a half block (`large`) or a quarter
 * block (`medium`, `small`: half a cell wide, so the pictures carry twice
 * the detail across).
 */
export type Art = 'full' | 'large' | 'medium' | 'small'

/** Each desk's box and the wall above them all, in pixels, per set of pictures. */
const DESKS: Record<Art, { w: number; h: number; wall: number; isQuad: boolean }> = {
  full: { w: 22, h: 22, wall: 10, isQuad: false },
  large: { w: 16, h: 16, wall: 6, isQuad: false },
  medium: { w: 24, h: 12, wall: 4, isQuad: true },
  small: { w: 16, h: 10, wall: 4, isQuad: true },
}
const FLAT_WALL_H = 2

/**
 * Floor between the desks: snug on the terminal, where a pixel is a cell,
 * roomy where the picture is scaled. Vertical gaps stay even, so the name
 * tags keep to whole terminal rows.
 */
export type Spacing = 'snug' | 'roomy'

function spacingOf(spacing: Spacing, art: Art): { gapX: number; gapY: number; margin: number; bottom: number } {
  if (spacing === 'roomy') return { gapX: 10, gapY: 16, margin: 8, bottom: 10 }
  if (DESKS[art].isQuad) return { gapX: 12, gapY: 6, margin: 6, bottom: 2 }

  return art === 'large' ? { gapX: 6, gapY: 6, margin: 3, bottom: 2 } : { gapX: 4, gapY: 2, margin: 3, bottom: 2 }
}
/** Frames in one loop of every animation; the SVG plays them at 4 a second. */
export const FRAMES = 8

export type Layout = {
  cols: number
  rows: number
  /** Pixel rows of wall above the desks. */
  wall: number
  spacing: Spacing
  art: Art
  /** Quarter-block pixels, two to a cell across: see Art. */
  isQuad: boolean
  /** Each desk's box, in pixels. */
  deskW: number
  deskH: number
  /** Cell of each seat: seat 0, the manager's, sits in the middle. */
  cells: { col: number; row: number }[]
  width: number
  height: number
}

/** Qué cambia en el dibujo de escritorio: bocadillos de texto en vez de iconos, y mesas con avatar propio. */
export type DrawOptions = { textBubbles?: boolean; avatarSeats?: ReadonlySet<number> }

/** How wide `cols` desks across are, in pixels. */
export function sceneWidth(cols: number, spacing: Spacing = 'snug', art: Art = 'full'): number {
  const { gapX, margin } = spacingOf(spacing, art)

  return margin * 2 + cols * DESKS[art].w + (cols - 1) * gapX
}

/** How many desks fit across `columns` terminal columns. */
export function colsFor(columns: number, spacing: Spacing = 'snug', art: Art = 'full'): number {
  const { gapX, margin } = spacingOf(spacing, art)
  const width = DESKS[art].isQuad ? columns * 2 : columns

  return Math.max(1, Math.floor((width - margin * 2 + gapX) / (DESKS[art].w + gapX)))
}

/**
 * The desks of `seatCount` seats: the manager's in the middle of an odd grid
 * and the others ringed around it, nearest first; on a narrow floor, a column.
 * `isFlat` spends width before height and lowers the wall, for a pane above
 * the prompt; `isWide` spends width before height too, but keeps the wall.
 */
export function layout(
  seatCount: number,
  maxCols: number,
  {
    isFlat = false,
    isWide = false,
    spacing = 'snug',
    art = 'full',
  }: { isFlat?: boolean; isWide?: boolean; spacing?: Spacing; art?: Art } = {},
): Layout {
  let cols: number
  let rows: number
  let cells: { col: number; row: number }[]

  if (maxCols < 3) {
    cols = Math.max(1, maxCols)
    rows = Math.max(1, Math.ceil(seatCount / cols))
    cells = []
    for (let i = 0; i < cols * rows; i++) {
      cells.push({ col: i % cols, row: Math.floor(i / cols) })
    }
  } else {
    const seats = Math.max(3, seatCount)
    cols = 3
    rows = 1
    for (let r = 1; r < 64; r += 2) {
      let c = Math.max(3, Math.ceil(seats / r))
      if (c % 2 === 0) c++
      if (c <= maxCols && (isFlat || isWide || c <= r + 2)) {
        cols = c
        rows = r
        break
      }
    }
    const cx = (cols - 1) / 2
    const cy = (rows - 1) / 2
    cells = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cells.push({ col, row })
      }
    }
    const rank = (cell: { col: number; row: number }) => {
      const dx = cell.col - cx
      const dy = cell.row - cy
      return [Math.max(Math.abs(dx), Math.abs(dy)), Math.abs(dy), Math.abs(dx), dy, dx]
    }
    cells.sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i]! - rb[i]!
      }
      return 0
    })
  }

  const desk = DESKS[art]
  const wall = isFlat ? FLAT_WALL_H : desk.wall
  const { gapY, bottom } = spacingOf(spacing, art)

  return {
    cols,
    rows,
    wall,
    spacing,
    art,
    isQuad: desk.isQuad,
    deskW: desk.w,
    deskH: desk.h,
    cells,
    width: sceneWidth(cols, spacing, art),
    height: wall + rows * desk.h + (rows - 1) * gapY + bottom,
  }
}

/**
 * En escritorio y móvil la oficina ocupa siempre el ancho del panel, así que el
 * tamaño decide cuántas mesas caben por fila: pequeño, muchas (agentes pequeños
 * y oficina baja); grande, tres (agentes grandes).
 */
export const REMOTE_LAYOUT: Record<AgentSize, { maxCols: number; isWide: boolean }> = {
  small: { maxCols: 9, isWide: true },
  medium: { maxCols: 5, isWide: true },
  large: { maxCols: 3, isWide: false },
}

export function stationOrigin(lay: Layout, seat: number): { x: number; y: number } | undefined {
  const cell = lay.cells[seat]
  if (cell === undefined) return undefined

  const { gapX, gapY, margin } = spacingOf(lay.spacing, lay.art)

  return { x: margin + cell.col * (lay.deskW + gapX), y: lay.wall + cell.row * (lay.deskH + gapY) }
}

/** A small number per agent, so desks side by side do not move in step. */
export function phaseOf(id: string): number {
  let h = 7
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }

  return h % FRAMES
}

export function iconFor(tool: string | null): IconName {
  if (tool === null) return 'think'
  if (/^(Read|Grep|Glob|LS|LSP|NotebookRead|ToolSearch)$/.test(tool)) return 'search'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Bash|BashOutput|KillShell|KillBash|PowerShell|Monitor|TaskOutput|TaskStop)$/.test(tool)) return 'shell'
  if (/^(WebFetch|WebSearch)$/.test(tool) || /browser|chrome|fetch/i.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage|Skill|TeamCreate)$/.test(tool)) return 'delegate'
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|EnterPlanMode|ExitPlanMode)$/.test(tool)) return 'todo'
  if (tool === 'AskUserQuestion') return 'ask'

  return 'tool'
}

const FLOOR_A = 0x353c4b
const FLOOR_B = 0x3a4253
const WALL = 0x4b5468
const WALL_DARK = 0x404859
const BASEBOARD = 0x2b303b
const RUG = 0x7a2e3a
const RUG_EDGE = 0xd4a73c
const CHAIR = 0x2f343f
const CHAIR_LIGHT = 0x454c59
const SCREEN_OFF = 0x14171d
const MONITOR = 0x23272f

function drawFloor(c: Canvas, wall: number): void {
  for (let y = wall; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const isA = (Math.floor(x / 6) + Math.floor((y - wall) / 6)) % 2 === 0
      c.set(x, y, isA ? FLOOR_A : FLOOR_B)
    }
  }
}

function drawWall(c: Canvas, wall: number): void {
  c.rect(0, 0, c.width, wall, WALL)
  c.rect(0, 0, c.width, 1, WALL_DARK)
  c.rect(0, wall - 2, c.width, 2, BASEBOARD)
  if (wall >= DESKS.full.wall) {
    drawWallProps(c)
  } else if (wall >= DESKS.large.wall) {
    const windows = Math.max(1, Math.floor((c.width - 6) / 20))
    const step = c.width / windows
    for (let i = 0; i < windows; i++) {
      const x = Math.round(step * i + step / 2) - 3
      c.rect(x, 1, 6, 3, 0x8892a6)
      c.rect(x + 1, 2, 4, 1, 0x8ccbea)
      c.set(x + 1, 2, 0xd8f0ff)
    }
  } else if (wall >= DESKS.small.wall) {
    // One row of glass, its x even, so each window keeps to whole quarter-block cells.
    const windows = Math.max(1, Math.floor(c.width / 18))
    const step = c.width / windows
    for (let i = 0; i < windows; i++) {
      const x = 2 * Math.round((step * i + step / 2 - 3) / 2)
      c.rect(x, 1, 6, 1, 0x8ccbea)
    }
  }
}

function drawRug(c: Canvas, x: number, y: number, w: number, h: number): void {
  const top = 2 * Math.round(h / 10)
  c.rect(x - 2, y + top, w + 4, h - top, RUG_EDGE)
  c.rect(x - 1, y + top + 1, w + 2, h - top - 2, RUG)
}

type Look = 'open' | 'left' | 'right' | 'closed' | 'happy' | 'dead'

const EYES: Record<Look, [number, number][]> = {
  open: [[3, 2], [3, 3], [8, 2], [8, 3]],
  left: [[2, 2], [2, 3], [7, 2], [7, 3]],
  right: [[4, 2], [4, 3], [9, 2], [9, 3]],
  closed: [[2, 3], [3, 3], [8, 3], [9, 3]],
  happy: [[2, 3], [3, 2], [4, 3], [7, 3], [8, 2], [9, 3]],
  dead: [[2, 1], [4, 1], [3, 2], [2, 3], [4, 3], [7, 1], [9, 1], [8, 2], [7, 3], [9, 3]],
}

/**
 * The Claude Code mascot, its top-left at (x, y): a body 10 wide and 7 tall,
 * eyes on rows 2 and 3, an arm each side on row 4, four legs under it.
 */
function drawCharacter(
  c: Canvas,
  x: number,
  y: number,
  style: AgentStyle,
  look: Look,
  arms: [number, number],
  t: number,
): void {
  const body = COLORS[style.color]
  const dark = shade(body, 0.72)
  c.rect(x + 1, y, 10, 6, body)
  c.rect(x + 1, y + 6, 10, 1, dark)
  for (const lx of [2, 4, 7, 9]) c.set(x + lx, y + 7, dark)
  c.set(x, y + 4 + arms[0], body)
  c.set(x + 11, y + 4 + arms[1], body)

  // Glasses and the like frame the eyes; shades hide them.
  const isOverEyes = style.accessory === 'shades'
  if (style.accessory !== 'none' && !isOverEyes) c.sprite(x, y, ACCESSORIES[style.accessory])
  for (const [ex, ey] of EYES[look]) c.set(x + ex, y + ey, INK.E!)
  if (isOverEyes) c.sprite(x, y, ACCESSORIES.shades)
  if (style.hat !== 'none') {
    const hat = HATS[style.hat]
    const frame = hat.frames[Math.floor(t / 2) % hat.frames.length]!
    c.sprite(x, y - frame.length + hat.overlap, frame)
  }
}

function drawChair(c: Canvas, x: number, y: number): void {
  c.rect(x + 1, y + 6, 12, 8, CHAIR)
  c.rect(x + 2, y + 6, 10, 1, CHAIR_LIGHT)
}

function drawDesk(c: Canvas, x: number, y: number, isManager: boolean): void {
  const top = isManager ? 0x9c4a2c : 0xc68e5c
  const edge = isManager ? RUG_EDGE : 0xdba673
  const front = isManager ? 0x6b2c1a : 0x8f5d38
  const foot = isManager ? 0x4e1f12 : 0x6e4529
  const w = DESKS.full.w
  c.rect(x, y + 14, w, 2, top)
  c.rect(x, y + 14, w, 1, edge)
  c.rect(x, y + 16, w, 3, front)
  c.rect(x, y + 18, w, 1, foot)
  c.rect(x + 1, y + 19, w - 2, 1, shade(FLOOR_A, 0.75))
  if (isManager) {
    c.rect(x + 8, y + 16, 6, 2, RUG_EDGE)
    c.rect(x + 9, y + 16, 4, 1, 0xf6e7a8)
  } else {
    c.rect(x + 10, y + 17, 2, 1, INK.G!)
  }
}

function drawKeyboard(c: Canvas, x: number, y: number): void {
  c.rect(x + 3, y + 14, 8, 1, 0xe6e8ec)
  c.rect(x + 3, y + 15, 8, 1, 0xa3a9b3)
  c.set(x + 12, y + 15, 0xe6e8ec)
}

const CODE_ROWS: [number, number, number][] = [
  [0, 4, 0x7fd4ff],
  [1, 3, 0xffcb6b],
  [1, 4, 0xc792ea],
  [2, 2, 0x89dd7f],
  [0, 3, 0xf78c6c],
  [1, 2, 0x7fd4ff],
  [2, 3, 0xffcb6b],
  [0, 2, 0xc792ea],
]

/** The monitor beside the desk: its screen says what the agent is up to. */
function drawMonitor(c: Canvas, x: number, y: number, agent: FactoryAgent | undefined, t: number): void {
  const mx = x + 14
  const my = y + 7
  c.rect(mx, my, 7, 6, MONITOR)
  c.set(x + 17, y + 13, MONITOR)
  c.rect(x + 16, y + 14, 3, 1, MONITOR)
  const sx = mx + 1
  const sy = my + 1
  c.rect(sx, sy, 5, 4, SCREEN_OFF)
  if (agent === undefined) return

  switch (agent.status) {
    case 'working': {
      const icon = iconFor(agent.tool)
      if (icon === 'web') {
        c.rect(sx, sy, 5, 4, 0xf3f4f6)
        c.rect(sx, sy, 5, 1, 0x3f6fd8)
        c.rect(sx + 1, sy + 2 + (t % 2), 3, 1, 0xa3a9b3)
        return
      }
      const isShell = icon === 'shell'
      c.rect(sx, sy, 5, 4, isShell ? 0x0b0f14 : 0x1e2533)
      for (let i = 0; i < 4; i++) {
        const [indent, len, color] = CODE_ROWS[(t + i) % CODE_ROWS.length]!
        c.rect(sx + indent, sy + i, Math.min(len, 5 - indent), 1, isShell ? 0x6cc24a : color)
      }
      if (icon === 'search') c.rect(sx, sy + 1, 5, 1, 0xf7d84a)
      return
    }
    case 'waiting':
      c.rect(sx, sy, 5, 4, 0x1f2b44)
      if (t % 4 < 2) c.set(sx, sy, 0xd7e6ff)
      return
    case 'failed':
      c.rect(sx, sy, 5, 4, 0x5a1f22)
      c.rect(sx + 2, sy, 1, 2, INK.W!)
      c.set(sx + 2, sy + 3, INK.W!)
      return
    case 'done':
      c.sprite(sx, sy, CHECK)
      return
    case 'sleeping':
      c.set(sx + (t < 4 ? t : 7 - t), sy + (t % 4 < 2 ? 1 : 2), 0x26324a)
      return
  }
}

/** A thought bubble over the monitor, its tail toward the agent's head. */
function drawBubble(c: Canvas, x: number, y: number, icon: IconName, t: number): void {
  const bx = x + 14
  const by = y
  c.rect(bx + 1, by, 5, 7, INK.W!)
  c.rect(bx, by + 1, 7, 5, INK.W!)
  c.set(bx, by + 6, INK.W!)
  c.set(bx - 1, by + 7, INK.W!)
  const frames = ICONS[icon]
  c.sprite(bx + 1, by + 1, frames[t % frames.length]!)
}

function drawSleep(c: Canvas, x: number, y: number, t: number): void {
  for (const offset of [0, 4]) {
    const s = (t + offset) % FRAMES
    if (s > 6) continue
    const zx = x + 12 + Math.floor(s / 2)
    const zy = y + 6 - s
    c.sprite(zx, Math.max(y, zy), s >= 3 ? BIG_Z : SMALL_Z)
  }
}

/** One desk: chair, agent, desk, monitor and what floats over the agent's head. */
function drawStation(
  c: Canvas,
  x: number,
  y: number,
  seat: number,
  sceneAgent: SceneAgent | undefined,
  frame: number,
  options: DrawOptions = {},
) {
  const isManager = seat === 0
  const hasAvatar = options.avatarSeats?.has(seat) === true
  drawChair(c, x, y)
  const agent = sceneAgent?.agent
  const t = agent === undefined ? 0 : (frame + phaseOf(agent.id)) % FRAMES

  if (sceneAgent !== undefined && agent !== undefined) {
    let look: Look = 'open'
    let arms: [number, number] = [0, 0]
    let dy = 0
    switch (agent.status) {
      case 'working':
        look = t === 5 ? 'closed' : 'right'
        arms = t % 2 === 0 ? [1, 0] : [0, 1]
        break
      case 'waiting':
        look = t < 3 ? 'open' : t < 5 ? 'left' : t < 6 ? 'open' : 'right'
        break
      case 'sleeping':
        look = 'closed'
        dy = t < 4 ? 0 : 1
        break
      case 'done':
        look = 'happy'
        arms = t % 4 < 2 ? [-1, -1] : [0, 0]
        break
      case 'failed':
        look = 'dead'
        arms = t % 2 === 0 ? [-1, 0] : [0, -1]
        break
    }
    if (!hasAvatar) drawCharacter(c, x + 1, y + 8 + dy, sceneAgent.style, look, arms, t)
  }

  drawDesk(c, x, y, isManager)
  drawKeyboard(c, x, y)
  drawMonitor(c, x, y, agent, t)

  if (agent === undefined) {
    // An empty desk keeps a plant for company.
    c.rect(x + 1, y + 12, 3, 2, 0x9c5a3c)
    c.set(x + 1, y + 11, INK.L!)
    c.set(x + 3, y + 10, INK.L!)
    c.set(x + 2, y + 11, INK.l!)
    return
  }

  if (agent.status === 'working' && options.textBubbles !== true) drawBubble(c, x, y, iconFor(agent.tool), t)
  if (agent.status === 'waiting') drawBubble(c, x, y, 'think', Math.min(2, Math.floor(t / 2)))
  if (hasAvatar) return // sus iconos de estado van como texto encima del avatar (badgeOf)
  if (agent.status === 'sleeping') drawSleep(c, x, y, t)
  if (agent.outcome === 'ok' && agent.status !== 'working') c.sprite(x + 1, y + 1, CHECK)
  if (agent.outcome === 'failed' && agent.status !== 'working') c.sprite(x + 2, y + 1, BANG)
}

const MINI_EYES: Record<Look, [number, number][]> = {
  open: [[2, 1], [2, 2], [5, 1], [5, 2]],
  left: [[1, 1], [1, 2], [4, 1], [4, 2]],
  right: [[3, 1], [3, 2], [6, 1], [6, 2]],
  closed: [[1, 2], [2, 2], [5, 2], [6, 2]],
  happy: [[1, 2], [2, 1], [5, 1], [6, 2]],
  dead: [[1, 1], [2, 2], [6, 1], [5, 2]],
}

/** The mascot for the small desks: a body 6 wide and 6 tall, eyes on rows 1 and 2, arms on row 3. */
function drawMiniCharacter(
  c: Canvas,
  x: number,
  y: number,
  style: AgentStyle,
  look: Look,
  arms: [number, number],
  t: number,
): void {
  const body = COLORS[style.color]
  const dark = shade(body, 0.72)
  c.rect(x + 1, y, 6, 5, body)
  c.rect(x + 1, y + 5, 6, 1, dark)
  for (const lx of [1, 3, 4, 6]) c.set(x + lx, y + 6, dark)
  c.set(x, y + 3 + arms[0], body)
  c.set(x + 7, y + 3 + arms[1], body)

  const isOverEyes = style.accessory === 'shades'
  if (style.accessory !== 'none' && !isOverEyes) c.sprite(x, y, MINI_ACCESSORIES[style.accessory])
  for (const [ex, ey] of MINI_EYES[look]) c.set(x + ex, y + ey, INK.E!)
  if (isOverEyes) c.sprite(x, y, MINI_ACCESSORIES.shades)
  if (style.hat !== 'none') {
    const hat = MINI_HATS[style.hat]
    const frame = hat.frames[Math.floor(t / 2) % hat.frames.length]!
    c.sprite(x, y - frame.length + hat.overlap, frame)
  }
}

/** The small monitor's 3x2 screen, saying what the agent is up to. */
function drawMiniScreen(c: Canvas, sx: number, sy: number, agent: FactoryAgent, t: number): void {
  switch (agent.status) {
    case 'working': {
      const icon = iconFor(agent.tool)
      if (icon === 'web') {
        c.rect(sx, sy, 3, 2, 0xf3f4f6)
        c.rect(sx, sy, 3, 1, 0x3f6fd8)
        return
      }
      const isShell = icon === 'shell'
      c.rect(sx, sy, 3, 2, isShell ? 0x0b0f14 : 0x1e2533)
      for (let i = 0; i < 2; i++) {
        const [indent, len, color] = CODE_ROWS[(t + i) % CODE_ROWS.length]!
        const left = Math.min(indent, 1)
        c.rect(sx + left, sy + i, Math.min(len, 3 - left), 1, isShell ? 0x6cc24a : color)
      }
      if (icon === 'search') c.rect(sx, sy + 1, 3, 1, 0xf7d84a)
      return
    }
    case 'waiting':
      c.rect(sx, sy, 3, 2, 0x1f2b44)
      if (t % 4 < 2) c.set(sx, sy, 0xd7e6ff)
      return
    case 'failed':
      c.rect(sx, sy, 3, 2, 0x5a1f22)
      c.set(sx + 1, sy, INK.W!)
      return
    case 'done':
      c.set(sx + 2, sy, INK.L!)
      c.set(sx + 1, sy + 1, INK.L!)
      return
    case 'sleeping':
      c.set(sx + (t % 3), sy + (t % 4 < 2 ? 0 : 1), 0x26324a)
      return
  }
}

/**
 * One small desk, 16 by 16: the agent on rows 6 to 10 above the desk top,
 * the monitor beside it, the bubble or the Zzz over the monitor, the name
 * tag on the last two rows.
 */
function drawMiniStation(c: Canvas, x: number, y: number, seat: number, sceneAgent: SceneAgent | undefined, frame: number) {
  const isManager = seat === 0
  const w = DESKS.large.w
  c.rect(x + 1, y + 5, 8, 6, CHAIR)
  c.rect(x + 2, y + 5, 6, 1, CHAIR_LIGHT)
  const agent = sceneAgent?.agent
  const t = agent === undefined ? 0 : (frame + phaseOf(agent.id)) % FRAMES

  if (sceneAgent !== undefined && agent !== undefined) {
    let look: Look = 'open'
    let arms: [number, number] = [0, 0]
    let dy = 0
    switch (agent.status) {
      case 'working':
        look = t === 5 ? 'closed' : 'right'
        arms = t % 2 === 0 ? [1, 0] : [0, 1]
        break
      case 'waiting':
        look = t < 3 ? 'open' : t < 5 ? 'left' : t < 6 ? 'open' : 'right'
        break
      case 'sleeping':
        look = 'closed'
        dy = t < 4 ? 0 : 1
        break
      case 'done':
        look = 'happy'
        arms = t % 4 < 2 ? [-1, -1] : [0, 0]
        break
      case 'failed':
        look = 'dead'
        arms = t % 2 === 0 ? [-1, 0] : [0, -1]
        break
    }
    drawMiniCharacter(c, x + 1, y + 6 + dy, sceneAgent.style, look, arms, t)
  }

  // The desk, the keyboard on it, and the monitor at its right end.
  c.rect(x, y + 11, w, 1, isManager ? 0x9c4a2c : 0xc68e5c)
  c.rect(x, y + 12, w, 1, isManager ? 0x6b2c1a : 0x8f5d38)
  c.rect(x, y + 13, w, 1, isManager ? 0x4e1f12 : 0x6e4529)
  if (isManager) c.rect(x + 3, y + 12, 4, 1, RUG_EDGE)
  c.rect(x + 2, y + 11, 6, 1, 0xe6e8ec)
  c.rect(x + 10, y + 6, 5, 4, MONITOR)
  c.set(x + 12, y + 10, MONITOR)
  c.rect(x + 11, y + 11, 3, 1, MONITOR)
  c.rect(x + 11, y + 7, 3, 2, SCREEN_OFF)

  if (agent === undefined) {
    // An empty desk keeps a plant for company.
    c.rect(x + 1, y + 9, 2, 2, 0x9c5a3c)
    c.set(x + 1, y + 8, INK.L!)
    c.set(x + 2, y + 7, INK.l!)
    return
  }
  drawMiniScreen(c, x + 11, y + 7, agent, t)

  const bubble = (icon: IconName, step: number) => {
    const bx = x + 10
    c.rect(bx + 1, y, 3, 5, INK.W!)
    c.rect(bx, y + 1, 5, 3, INK.W!)
    c.set(bx - 1, y + 5, INK.W!)
    const frames = MINI_ICONS[icon]
    c.sprite(bx + 1, y + 1, frames[step % frames.length]!)
  }
  if (agent.status === 'working') bubble(iconFor(agent.tool), t)
  if (agent.status === 'waiting') bubble('think', Math.floor(t / 2))
  if (agent.status === 'sleeping') {
    for (const offset of [0, 4]) {
      const s = (t + offset) % FRAMES
      if (s > 5) continue
      c.sprite(x + 9 + Math.floor(s / 2), Math.max(y, y + 4 - s), s >= 3 ? MINI_BIG_Z : MINI_SMALL_Z)
    }
  }
  if (agent.outcome === 'ok' && agent.status !== 'working') c.sprite(x, y + 1, MINI_CHECK)
  if (agent.outcome === 'failed' && agent.status !== 'working') c.sprite(x + 1, y, MINI_BANG)
}

/** Where things sit on a medium or small desk, in its quarter-block pixels. */
type Compact = {
  /** The body's top-left, its width and rows (the last one dark), the arms' row, the legs under it. */
  body: { x: number; y: number; w: number; rows: number; armRow: number; legs: number[] }
  eyes: Record<Look, [number, number, string?][]>
  hats: Record<Exclude<HatName, 'none'>, Hat>
  accessories: Record<Exclude<AccessoryName, 'none'>, Sprite>
  chair: [number, number, number, number]
  deskY: number
  monitor: [number, number, number, number]
  bubble: [number, number, number, number]
  chip: [number, number, number, number]
  /** Where a rising Zzz starts, and where the check or the `!` stands. */
  zzz: [number, number]
  badge: [number, number]
  label: number
}

const COMPACT: Record<'medium' | 'small', Compact> = {
  medium: {
    body: { x: 2, y: 4, w: 10, rows: 4, armRow: 2, legs: [] },
    eyes: {
      open: [[2, 1], [7, 1]],
      left: [[1, 1], [6, 1]],
      right: [[3, 1], [8, 1]],
      closed: [[1, 1, 'd'], [2, 1, 'd'], [7, 1, 'd'], [8, 1, 'd']],
      happy: [[1, 1], [2, 1], [7, 1], [8, 1]],
      dead: [[2, 1, 'R'], [7, 1, 'R']],
    },
    hats: MEDIUM_HATS,
    accessories: MEDIUM_ACCESSORIES,
    chair: [0, 4, 14, 4],
    deskY: 8,
    monitor: [16, 4, 6, 4],
    bubble: [16, 0, 6, 4],
    chip: [18, 1, 2, 2],
    zzz: [14, 5],
    badge: [17, 0],
    label: 10,
  },
  small: {
    body: { x: 2, y: 2, w: 6, rows: 3, armRow: 1, legs: [1, 4] },
    eyes: {
      open: [[1, 1], [4, 1]],
      left: [[0, 1], [3, 1]],
      right: [[2, 1], [5, 1]],
      closed: [[1, 1, 'd'], [4, 1, 'd']],
      happy: [[1, 1, 'd'], [4, 1, 'd']],
      dead: [[1, 1, 'R'], [4, 1, 'R']],
    },
    hats: SMALL_HATS,
    accessories: SMALL_ACCESSORIES,
    chair: [0, 2, 10, 4],
    deskY: 6,
    monitor: [10, 2, 4, 4],
    bubble: [10, 0, 4, 2],
    chip: [12, 0, 2, 2],
    zzz: [9, 1],
    badge: [10, 0],
    label: 8,
  },
}

/** A medium or small desk: the same scene as the others, told in fewer, half-width pixels. */
function drawCompactStation(
  k: Compact,
  c: Canvas,
  x: number,
  y: number,
  seat: number,
  sceneAgent: SceneAgent | undefined,
  frame: number,
) {
  const isManager = seat === 0
  const w = k.monitor[0] + k.monitor[2] + 2
  const { body } = k
  c.rect(x + k.chair[0], y + k.chair[1], k.chair[2], k.chair[3], CHAIR)
  const agent = sceneAgent?.agent
  const t = agent === undefined ? 0 : (frame + phaseOf(agent.id)) % FRAMES

  if (sceneAgent !== undefined && agent !== undefined) {
    const { style } = sceneAgent
    let look: Look = 'open'
    let arms: [number, number] = [0, 0]
    let dy = 0
    switch (agent.status) {
      case 'working':
        look = t === 5 ? 'closed' : 'right'
        arms = t % 2 === 0 ? [-1, 0] : [0, -1]
        break
      case 'waiting':
        look = t < 3 ? 'open' : t < 5 ? 'left' : t < 6 ? 'open' : 'right'
        break
      case 'sleeping':
        look = 'closed'
        dy = t < 4 ? 0 : 1
        break
      case 'done':
        look = 'happy'
        arms = t % 4 < 2 ? [-1, -1] : [0, 0]
        break
      case 'failed':
        look = 'dead'
        arms = t % 2 === 0 ? [-1, 0] : [0, -1]
        break
    }
    const bx = x + body.x
    const by = y + body.y + dy
    const color = COLORS[style.color]
    const dark = shade(color, 0.72)
    c.rect(bx, by, body.w, body.rows - 1, color)
    c.rect(bx, by + body.rows - 1, body.w, 1, dark)
    for (const leg of body.legs) c.set(bx + leg, by + body.rows, dark)
    c.set(bx - 1, by + body.armRow + arms[0], color)
    c.set(bx + body.w, by + body.armRow + arms[1], color)
    const isOverEyes = style.accessory === 'shades'
    if (style.accessory !== 'none' && !isOverEyes) c.sprite(bx - 1, by, k.accessories[style.accessory])
    for (const [ex, ey, ink] of k.eyes[look]) {
      c.set(bx + ex, by + ey, ink === 'd' ? shade(color, 0.55) : INK[ink ?? 'E']!)
    }
    if (isOverEyes) c.sprite(bx - 1, by, k.accessories.shades)
    if (style.hat !== 'none') {
      const hat = k.hats[style.hat]
      const hatFrame = hat.frames[Math.floor(t / 2) % hat.frames.length]!
      c.sprite(bx - 1, by - hatFrame.length + hat.overlap, hatFrame)
    }
  }

  // The desk across the whole box, a keyboard on it, the monitor at its right.
  c.rect(x, y + k.deskY, w, 1, isManager ? 0x9c4a2c : 0xc68e5c)
  c.rect(x, y + k.deskY + 1, w, 1, isManager ? 0x6b2c1a : 0x8f5d38)
  if (isManager) c.rect(x + body.x + 2, y + k.deskY + 1, body.w - 4, 1, RUG_EDGE)
  c.rect(x + body.x, y + k.deskY, body.w, 1, 0xe6e8ec)
  const [mx, my, mw, mh] = k.monitor
  c.rect(x + mx, y + my, mw, mh, MONITOR)
  const sx = x + mx + 1
  const sy = y + my + 1
  const sw = mw - 2
  const sh = mh - 2
  c.rect(sx, sy, sw, sh, SCREEN_OFF)

  if (agent === undefined) {
    // An empty desk keeps a plant for company.
    c.rect(x + body.x, y + k.deskY - 2, 2, 2, 0x9c5a3c)
    c.rect(x + body.x, y + k.deskY - 3, 1, 1, INK.L!)
    c.rect(x + body.x + 1, y + k.deskY - 4, 1, 1, INK.l!)
    return
  }

  // The screen, a whole row of one color at a time: a quarter-block cell paints two.
  switch (agent.status) {
    case 'working': {
      const icon = iconFor(agent.tool)
      for (let i = 0; i < sh; i++) {
        const code = CODE_ROWS[(t + i) % CODE_ROWS.length]![2]
        const row =
          icon === 'web' ? (i === 0 ? 0x3f6fd8 : 0xf3f4f6) : icon === 'shell' ? (i % 2 === t % 2 ? 0x6cc24a : 0x0b0f14) : code
        c.rect(sx, sy + i, sw, 1, row)
      }
      break
    }
    case 'waiting':
      c.rect(sx, sy, sw, sh, t % 4 < 2 ? 0x2a3a5c : 0x1f2b44)
      break
    case 'failed':
      c.rect(sx, sy, sw, sh, 0x8a2a30)
      break
    case 'done':
      c.rect(sx, sy, sw, sh, 0x2f6b3a)
      break
    case 'sleeping':
      c.rect(sx, sy + (t % 4 < 2 ? 0 : sh - 1), sw, 1, 0x1a2130)
      break
  }

  const [bx0, by0, bw0, bh0] = k.bubble
  const [cx0, cy0, cw0, ch0] = k.chip
  if (agent.status === 'working' || agent.status === 'waiting') {
    c.rect(x + bx0, y + by0, bw0, bh0, INK.W!)
    c.set(x + bx0, y + by0, FLOOR_A)
    c.set(x + bx0 + bw0 - 1, y + by0, FLOOR_A)
    const icon = agent.status === 'working' ? iconFor(agent.tool) : 'think'
    if (icon !== 'think' || t % 2 === 0) c.rect(x + cx0, y + cy0, cw0, ch0, INK[CHIPS[icon]]!)
  }
  if (agent.status === 'sleeping') {
    for (const offset of [0, 4]) {
      const s = (t + offset) % FRAMES
      if (s > 4) continue
      c.set(x + k.zzz[0] + (s >> 1), y + k.zzz[1] - s, INK.Z!)
    }
  }
  const [gx, gy] = k.badge
  if (agent.outcome === 'ok' && agent.status !== 'working') {
    c.set(x + gx, y + gy + 1, INK.L!)
    c.set(x + gx + 1, y + gy + 2, INK.L!)
    c.set(x + gx + 2, y + gy + 1, INK.L!)
    c.set(x + gx + 3, y + gy, INK.L!)
  }
  if (agent.outcome === 'failed' && agent.status !== 'working') {
    c.rect(x + gx + 1, y + gy, 1, 2, INK.R!)
    c.set(x + gx + 1, y + gy + 3, INK.R!)
  }
}

/** Seats sorted by number, each with the agent at it. */
function seatMap(agents: readonly SceneAgent[]): Map<number, SceneAgent> {
  return new Map(agents.map(one => [one.agent.seat, one]))
}

/** How many seats the floor needs for these agents. */
export function seatsNeeded(agents: readonly SceneAgent[]): number {
  return agents.reduce((most, one) => Math.max(most, one.agent.seat + 1), 1)
}

/** Corner brackets around the desk being styled. */
function drawHighlight(c: Canvas, x: number, y: number, w: number, h: number, t: number): void {
  const color = t % 4 < 2 ? INK.Y! : INK.y!
  const right = x + w - 1
  const bottom = y + h - 1
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [right, y, -1, 1],
    [x, bottom, 1, -1],
    [right, bottom, -1, -1],
  ] as const) {
    c.rect(Math.min(cx, cx + dx * 2), cy, 3, 1, color)
    c.rect(cx, Math.min(cy, cy + dy * 2), 1, 3, color)
  }
}

export function drawScene(
  lay: Layout,
  agents: readonly SceneAgent[],
  frame: number,
  highlightSeat?: number,
  options: DrawOptions = {},
): Canvas {
  const c = new Canvas(lay.width, lay.height, FLOOR_A)
  drawFloor(c, lay.wall)
  drawWall(c, lay.wall)
  if (lay.art === 'full' && lay.spacing === 'roomy' && lay.wall >= DESKS.full.wall) drawFloorProps(c, lay.wall)
  const bySeat = seatMap(agents)
  const manager = stationOrigin(lay, 0)
  if (manager !== undefined) drawRug(c, manager.x, manager.y, lay.deskW, lay.deskH)
  const draw =
    lay.art === 'full'
      ? (c: Canvas, x: number, y: number, seat: number, one: SceneAgent | undefined, f: number) =>
          drawStation(c, x, y, seat, one, f, options)
      : lay.art === 'large'
        ? drawMiniStation
        : (c: Canvas, x: number, y: number, seat: number, one: SceneAgent | undefined, f: number) =>
            drawCompactStation(COMPACT[lay.art as 'medium' | 'small'], c, x, y, seat, one, f)
  for (let seat = 0; seat < lay.cells.length; seat++) {
    const origin = stationOrigin(lay, seat)
    if (origin !== undefined) draw(c, origin.x, origin.y, seat, bySeat.get(seat), frame)
  }
  const highlight = highlightSeat === undefined ? undefined : stationOrigin(lay, highlightSeat)
  if (highlight !== undefined) drawHighlight(c, highlight.x, highlight.y, lay.deskW, lay.deskH, frame % FRAMES)

  return c
}

const STATUS_COLORS: Record<FactoryAgent['status'], number> = {
  working: 0xffffff,
  waiting: 0xf7e08a,
  sleeping: 0x9aa3b5,
  done: 0x8fe08a,
  failed: 0xff8a8a,
}

export function statusColor(status: FactoryAgent['status']): number {
  return STATUS_COLORS[status]
}

/**
 * How many letters a desk's name tag holds, a letter to a column: the desk's
 * width and the floor beside it, less one column, so the tags of desks side
 * by side never touch. A letter cannot be drawn smaller than its cell, so
 * the small desks' tags spill into the floor to stay readable.
 */
export function labelChars(lay: Layout): number {
  const perColumn = lay.isQuad ? 2 : 1
  const { gapX } = spacingOf(lay.spacing, lay.art)

  return Math.floor((lay.deskW + gapX) / perColumn) - 1
}

/** Each desk's name tag, `maxChars` wide at most, centered under its desk. */
export function sceneLabels(lay: Layout, agents: readonly SceneAgent[], maxChars: number): Label[] {
  const perColumn = lay.isQuad ? 2 : 1
  const columns = labelChars(lay)
  const labels: Label[] = []
  for (const { agent } of agents) {
    const origin = stationOrigin(lay, agent.seat)
    if (origin === undefined) continue
    const text = clip(tagOf(agent), maxChars)
    const y = lay.isQuad ? origin.y + COMPACT[lay.art as 'medium' | 'small'].label : origin.y + lay.deskH - 2
    const x = origin.x + perColumn * Math.floor((lay.deskW / perColumn - columns) / 2)
    labels.push({ x, y, width: columns * perColumn, text, color: statusColor(agent.status) })
  }

  return labels
}

export function sceneHotspots(lay: Layout, agents: readonly SceneAgent[], describe: (a: FactoryAgent) => string): Hotspot[] {
  const spots: Hotspot[] = []
  for (const { agent } of agents) {
    const origin = stationOrigin(lay, agent.seat)
    if (origin === undefined) continue
    spots.push({ ...origin, width: lay.deskW, height: lay.deskH, title: describe(agent) })
  }

  return spots
}

export function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`
}

/** Medidas del texto de los bocadillos, en píxeles del dibujo. */
export const BUBBLE_FONT = 2.8
export const BUBBLE_LINE_H = 3.2

export type BubbleBox = { x: number; y: number; width: number; height: number; tailX: number; tailY: number }

/**
 * Dónde va el bocadillo de una mesa (solo en el dibujo grande): encima de la
 * cabeza, sin salirse del dibujo ni tapar la etiqueta de la fila de arriba.
 */
export function bubbleBox(lay: Layout, seat: number, lineCount: number): BubbleBox | undefined {
  const origin = stationOrigin(lay, seat)
  if (origin === undefined || lay.art !== 'full') return undefined
  const { gapX } = spacingOf(lay.spacing, lay.art)
  const width = lay.deskW + gapX - 2
  const height = lineCount * BUBBLE_LINE_H + 2
  const headX = origin.x + 7
  const x = Math.max(1, Math.min(lay.width - width - 1, headX - width / 2))
  const y = Math.max(0, origin.y + 1 - height)

  return { x, y, width, height, tailX: headX, tailY: origin.y + 4 }
}

export type Box = { x: number; y: number; width: number; height: number }

/** El hueco del personaje en una mesa del dibujo grande: ahí va el avatar del proyecto. */
export function avatarBox(lay: Layout, seat: number): Box | undefined {
  const origin = stationOrigin(lay, seat)
  if (origin === undefined || lay.art !== 'full') return undefined
  return { x: origin.x, y: origin.y + 1, width: 14, height: 13 }
}

export type Badge = { text: string; color: string }

/** El icono de estado de un agente con avatar propio: ✓, ! o z, que se dibuja como texto encima. */
export function badgeOf(agent: FactoryAgent): Badge | undefined {
  if (agent.status === 'sleeping') return { text: 'z', color: '#d7e6ff' }
  if (agent.status === 'working') return undefined
  if (agent.outcome === 'ok') return { text: '✓', color: '#6cc24a' }
  if (agent.outcome === 'failed') return { text: '!', color: '#e0484d' }
  return undefined
}
