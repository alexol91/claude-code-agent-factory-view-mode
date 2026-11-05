import { describe, expect, mock, test, type MockClock } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import type { FactoryAgent } from '../types'
import { disk, fakePng } from './fixtures'
import {
  addAgent,
  clearFinished,
  defaultStyle,
  labelFor,
  mainAgent,
  parseStyle,
  randomStyle,
  settle,
  styleOf,
  tagOf,
  toolDetail,
  withMain,
  DONE_DOZE_MS,
  MAIN_DOZE_MS,
} from '../hooks/model'
import { avatarBox, bubbleBox, drawScene, labelChars, layout, REMOTE_LAYOUT, sceneLabels, stationOrigin } from '../hooks/scene'
import { AVATAR_MODE, base64, FILL_WIDTH, fillScale, fitAvatars, quadrantCell, rasterCells, sceneSvg, SVG_LIMIT, type SvgAvatar } from '../hooks/paint'
import { COLORS } from '../hooks/sprites'

const PLUGIN = 'oficina'

const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'oficina',
  props: {
    title: 'Oficina',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const explorer: AgentInfo = {
  id: 'agent-1',
  description: 'Map the repository',
  type: 'Explore',
  status: 'running',
}

describe('the floor plan', () => {
  test('en escritorio, pequeño pone más mesas por fila y grande menos, sin bajar la pared', () => {
    const desks = (size: 'small' | 'medium' | 'large') => {
      const { maxCols, isWide } = REMOTE_LAYOUT[size]
      return layout(7, maxCols, { spacing: 'roomy', isWide })
    }
    expect(desks('small').cols).toBe(7)
    expect(desks('small').rows).toBe(1)
    expect(desks('large').cols).toBe(3)
    expect(desks('large').rows).toBe(3)
    expect(desks('medium').cols).toBeLessThanOrEqual(5)
    expect(layout(5, REMOTE_LAYOUT.medium.maxCols, { spacing: 'roomy', isWide: true }).rows).toBe(1)
    for (const size of ['small', 'medium', 'large'] as const) expect(desks(size).wall).toBe(10)
  })

  test('en escritorio el dibujo declara un ancho mayor que cualquier panel, y el alto en proporción', () => {
    const lay = layout(3, 7, { spacing: 'roomy' })
    const svg = sceneSvg([drawScene(lay, [], 0)], [], [], { scale: fillScale(lay.width), secondsPerFrame: 0.25 })
    const height = Math.round(lay.height * fillScale(lay.width) * 1000) / 1000
    expect(svg).toContain(`viewBox="0 0 ${lay.width} ${lay.height}" width="${FILL_WIDTH}" height="${height}"`)
    expect(FILL_WIDTH).toBeGreaterThanOrEqual(4000)
  })

  test('el bocadillo de texto queda encima de la cabeza y dentro del dibujo', () => {
    const lay = layout(9, 7, { spacing: 'roomy' })
    for (let seat = 0; seat < 9; seat++) {
      const box = bubbleBox(lay, seat, 2)!
      const origin = stationOrigin(lay, seat)!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(lay.width)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(origin.y + 1.001)
    }
    expect(bubbleBox(layout(9, 3, { art: 'medium' }), 0, 2)).toBeUndefined()
  })

  test('el SVG lleva el texto de los bocadillos, escapado', () => {
    const lay = layout(1, 7, { spacing: 'roomy' })
    const scene = [{ agent: mainAgent(0), style: defaultStyle(mainAgent(0)) }]
    const bubble = { ...bubbleBox(lay, 0, 1)!, lines: ['Leyendo <a>.ts'] }
    const svg = sceneSvg([drawScene(lay, scene, 0)], [], [], { scale: 1, secondsPerFrame: 0.25 }, { bubbles: [bubble] })
    expect(svg).toContain('>Leyendo &#60;a&#62;.ts<')
  })

  test('the manager sits in the middle and the others ring around it', () => {
    const lay = layout(9, 7)
    expect(lay.cols).toBe(3)
    expect(lay.rows).toBe(3)
    expect(lay.cells[0]).toEqual({ col: 1, row: 1 })
    expect(lay.cells[1]).toEqual({ col: 0, row: 1 })
    expect(lay.cells[2]).toEqual({ col: 2, row: 1 })
  })

  test('a narrow pane stacks the desks in a column', () => {
    const lay = layout(3, 1)
    expect(lay.cols).toBe(1)
    expect(lay.rows).toBe(3)
  })

  test('each terminal size takes less room than the one above it', () => {
    const cells = (art: 'large' | 'medium' | 'small') => {
      const lay = layout(9, 3, { art })
      return { columns: lay.isQuad ? lay.width / 2 : lay.width, rows: lay.height / 2, lay }
    }
    const [large, medium, small] = [cells('large'), cells('medium'), cells('small')]
    expect(medium.columns).toBeLessThan(large.columns)
    expect(small.columns).toBeLessThan(medium.columns)
    expect(medium.rows).toBeLessThan(large.rows)
    expect(small.rows).toBeLessThan(medium.rows)
    for (const { lay } of [large, medium, small]) {
      // Desks start on even rows so name tags keep to whole cells, and on
      // even columns too where a cell is two pixels wide.
      expect(stationOrigin(lay, 8)!.y % 2).toBe(0)
      if (lay.isQuad) expect(stationOrigin(lay, 8)!.x % 2).toBe(0)
    }
  })

  test('name tags spill under the floor beside their desk, never into the next tag', () => {
    for (const art of ['large', 'medium', 'small'] as const) {
      const lay = layout(3, 3, { art })
      expect(labelChars(lay)).toBeGreaterThanOrEqual(12)
      let agents: FactoryAgent[] = [{ ...mainAgent(0), label: 'A long name for a tag' }]
      for (let i = 1; i < 3; i++) agents = addAgent(agents, { id: `a${i}`, type: 'x', label: 'Another long name', description: '' }, 0)
      const tags = sceneLabels(lay, agents.map(agent => ({ agent, style: defaultStyle(agent) })), labelChars(lay))
      const spans = tags.map(tag => [tag.x, tag.x + tag.width] as const).sort((a, b) => a[0] - b[0])
      expect(spans[0]![0]).toBeGreaterThanOrEqual(0)
      expect(spans[2]![1]).toBeLessThanOrEqual(lay.width)
      expect(spans[0]![1]).toBeLessThan(spans[1]![0])
      expect(spans[1]![1]).toBeLessThan(spans[2]![0])
    }
  })

  test('a quarter-block cell paints its two commonest colors', () => {
    const [a, b, c] = [0x111111, 0xeeeeee, 0xdddddd]
    expect(quadrantCell([a, a, b, b])).toEqual({ ch: 0x2584, fg: b, bg: a })
    expect(quadrantCell([a, a, a, b])).toEqual({ ch: 0x2597, fg: b, bg: a })
    expect(quadrantCell([a, a, a, a]).ch).toBe(0x20)
    expect(quadrantCell([a, b, c, a]).ch).toBe(0x259e)
  })

  test('a flat pane spends width before height', () => {
    expect(layout(7, 7, { isFlat: true }).rows).toBe(1)
    expect(layout(7, 7).rows).toBe(3)
  })

  test('the terminal picture is two pixels a cell and the SVG stays in bounds', () => {
    let agents: FactoryAgent[] = [mainAgent(0)]
    for (let i = 1; i <= 24; i++) agents = addAgent(agents, { id: `a${i}`, type: `type${i}`, label: `a${i}`, description: '' }, 0)
    const scene = agents.map(agent => ({ agent, style: { color: 'clay', hat: 'wizard', accessory: 'scarf' } as const }))
    const lay = layout(25, 7)
    const canvas = drawScene(lay, scene, 0)
    const picture = rasterCells(canvas, [])
    expect(picture.columns).toBe(lay.width)
    expect(picture.rows).toBe(Math.ceil(lay.height / 2))
    const frames = Array.from({ length: 8 }, (_, f) => drawScene(lay, scene, f))
    expect(sceneSvg(frames, [], [], { scale: 4, secondsPerFrame: 0.25 }).length).toBeLessThanOrEqual(SVG_LIMIT)
    expect(stationOrigin(lay, 24)).toBeDefined()
  })

  test('una mesa con avatar propio no dibuja el personaje por defecto', () => {
    const lay = layout(1, 7, { spacing: 'roomy' })
    const scene = [{ agent: mainAgent(0), style: defaultStyle(mainAgent(0)) }]
    const custom = drawScene(lay, scene, 0, undefined, { avatarSeats: new Set([0]) })
    const box = avatarBox(lay, 0)!
    let clay = 0
    for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) if (custom.get(x, y) === COLORS.clay) clay++
    expect(clay).toBe(0)
    expect(avatarBox(layout(1, 3, { art: 'medium' }), 0)).toBeUndefined()
  })

  test('un avatar de proyecto va como PNG en el SVG, una copia por proyecto', () => {
    const lay = layout(3, 7, { spacing: 'roomy' })
    let agents: FactoryAgent[] = [mainAgent(0)]
    agents = addAgent(agents, { id: 'a1', type: 'Explore', label: 'uno', description: '' }, 0)
    agents = addAgent(agents, { id: 'a2', type: 'Explore', label: 'dos', description: '' }, 0)
    const scene = agents.map(agent => ({ agent, style: defaultStyle(agent) }))
    const png = base64(fakePng(32, 32))
    const avatars: SvgAvatar[] = [1, 2].map(seat => ({
      ...avatarBox(lay, seat)!,
      seat,
      key: '/w/freezer',
      frames: [png],
      imageWidth: 32,
      imageHeight: 32,
      fps: 4,
    }))
    const frames = [drawScene(lay, scene, 0, undefined, { avatarSeats: new Set([1, 2]) })]
    const svg = sceneSvg(frames, [], [], { scale: 1, secondsPerFrame: 0.25 }, { avatars })
    expect(svg.split(`data:image/png;base64,${png}`).length - 1).toBe(AVATAR_MODE === 'use' ? 1 : 2)
  })

  test('un avatar animado alterna sus fotogramas al ritmo de su fps', () => {
    const lay = layout(1, 7, { spacing: 'roomy' })
    const scene = [{ agent: mainAgent(0), style: defaultStyle(mainAgent(0)) }]
    const frames = ['a', 'b', 'c'].map((_, i) => base64(fakePng(16, 16, 30 + i)))
    const avatar: SvgAvatar = { ...avatarBox(lay, 0)!, seat: 0, key: 'k', frames, imageWidth: 16, imageHeight: 16, fps: 4 }
    const svg = sceneSvg([drawScene(lay, scene, 0)], [], [], { scale: 1, secondsPerFrame: 0.25 }, { avatars: [avatar] })
    expect(svg).toContain('values="visible;hidden;hidden" dur="0.75s"')
  })

  test('si no cabe, los avatares pasan a un fotograma y luego desaparecen', () => {
    const one: SvgAvatar = { x: 0, y: 0, width: 14, height: 13, seat: 1, key: 'k', frames: ['a', 'b'], imageWidth: 8, imageHeight: 8, fps: 4 }
    const tried: number[][] = []
    const build = (fitsUpTo: number) => (avatars: readonly SvgAvatar[]) => {
      tried.push(avatars.map(a => a.frames.length))
      const frames = avatars.reduce((n, a) => n + a.frames.length, 0)
      return 'x'.repeat(frames > fitsUpTo ? SVG_LIMIT + 1 : 10)
    }
    expect(fitAvatars([one], build(2))).toBe('x'.repeat(10))
    tried.length = 0
    fitAvatars([one], build(1))
    expect(tried).toEqual([[2], [1]])
    tried.length = 0
    fitAvatars([one], build(0))
    expect(tried).toEqual([[2], [1], []])
  })
})

describe('the agents', () => {
  test('un agente guardado por una versión anterior, sin proyecto ni llegada, se completa al leerlo', () => {
    const { project: _p, startedAt: _s, ...old } = { ...mainAgent(0), id: 'viejo', isMain: false, seat: 1, since: 500 }
    const [, agent] = withMain([mainAgent(0), old as unknown as FactoryAgent], 0)
    expect(agent!.project).toBeNull()
    expect(agent!.startedAt).toBe(500)
    expect(tagOf(agent!)).toBe(agent!.label)
  })

  test('un Bash con descripción en blanco usa el comando', () => {
    expect(toolDetail('Bash', { command: 'ls', description: '  ' })).toBe('Ejecutando ls')
  })

  test('a new agent takes the nearest free desk, and a full floor sends the oldest finished one home', () => {
    let agents: FactoryAgent[] = [mainAgent(0)]
    for (let i = 1; i <= 24; i++) agents = addAgent(agents, { id: `a${i}`, type: 'Explore', label: '', description: '' }, i)
    expect(agents.map(a => a.seat)).toEqual(Array.from({ length: 25 }, (_, i) => i))
    agents = agents.map(a => (a.id === 'a3' ? { ...a, status: 'done' as const, since: 1 } : a))
    agents = addAgent(agents, { id: 'late', type: 'Plan', label: '', description: '' }, 100)
    expect(agents.find(a => a.id === 'a3')).toBeUndefined()
    expect(agents.find(a => a.id === 'late')?.seat).toBe(3)
  })

  test('waiting and finished agents doze off, and finished ones can be sent home', () => {
    const agents = addAgent([mainAgent(0)], { id: 'a1', type: 'Explore', label: '', description: '', status: 'done' }, 0)
    expect(settle(agents, 1000)).toBeNull()
    const later = settle(agents, MAIN_DOZE_MS + DONE_DOZE_MS) ?? []
    expect(later.map(a => a.status)).toEqual(['sleeping', 'sleeping'])
    expect(clearFinished(later).map(a => a.id)).toEqual(['main'])
  })

  test('undressed agents draw a look of their own by lot, or dress for their type', () => {
    const one = { id: 'agent-1', isMain: false, type: 'Explore' }
    const two = { id: 'agent-2', isMain: false, type: 'Explore' }
    expect(defaultStyle(one, 'random')).toEqual(defaultStyle(one, 'random'))
    expect(defaultStyle(one, 'random')).not.toEqual(defaultStyle(two, 'random'))
    expect(defaultStyle(one, 'type')).toEqual(defaultStyle(two, 'type'))
    expect(defaultStyle(mainAgent(0), 'random')).toEqual({ color: 'clay', hat: 'crown', accessory: 'tie' })
    for (let seed = 0; seed < 300; seed++) {
      const style = randomStyle(seed)
      expect(style.color).not.toBe('clay')
      expect(style.hat).not.toBe('crown')
    }
  })

  test("an agent's own look wins over its type's, and its type's over the default", () => {
    const one = { id: 'agent-1', isMain: false, type: 'Explore' }
    const viking = { color: 'snow', hat: 'viking', accessory: 'none' } as const
    const chef = { color: 'sun', hat: 'chef', accessory: 'mustache' } as const
    expect(styleOf(one, { 'type:Explore': chef })).toEqual(chef)
    expect(styleOf(one, { 'type:Explore': chef, 'agent:agent-1': viking })).toEqual(viking)
  })

  test("a desk's name tag is the agent's name, else its own type, else its task", () => {
    expect(labelFor('scout', 'Map the repository', 'Explore')).toBe('scout')
    expect(labelFor(undefined, 'Put the prologue in', 'story')).toBe('story')
    expect(labelFor(undefined, 'Run the suite', 'my-plugin:runner')).toBe('runner')
    expect(labelFor(undefined, 'Map the repository', 'Explore')).toBe('Map repository')
    expect(labelFor(undefined, '', 'general-purpose')).toBe('general-purpose')
  })

  test('vestir entiende color, sombrero y extra en español, y nombra lo que no entiende', () => {
    expect(parseStyle(['color=cielo', 'sombrero=corona', 'extra=gafas-de-sol'])).toEqual({
      change: { color: 'sky', hat: 'crown', accessory: 'shades' },
    })
    expect(parseStyle(['sombrero=sombrerazo'])).toEqual({ error: 'sombrero=sombrerazo' })
    expect(parseStyle(['hat=crown'])).toEqual({ error: 'hat=crown' })
  })
})

/** The engine beneath the plugins: the agent list, and sessions and turns that just go by. */
function engine(on: On, agents: AgentInfo[]): MockClock {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  on('agent.list', () => ({ value: agents }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return clock
}

/** `/oficina <args>` escrito en el prompt. */
const oficina = (args: string) =>
  ({ command: 'oficina', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const

type Finder = { find: (q: { key: string }) => Promise<{ children: unknown[]; props: Record<string, unknown> } | undefined> }

const flat = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : typeof node === 'object' && node !== null && 'children' in node
      ? ((node as { children: unknown[] }).children ?? []).map(flat).join('')
      : ''

/** Todo el texto de un elemento, por su clave. */
async function textOf(ui: Finder, key: string) {
  const node = await ui.find({ key })
  return node === undefined ? undefined : flat(node)
}

/** Lo que dice la lista de un agente: su línea entera. */
const legendLine = (ui: Finder, id: string) => textOf(ui, `agent-${id}`)

describe('the session', () => {
  test('cada subagente toma el proyecto de lo que toca, con el nombre de avatar.json', async ($, on) => {
    engine(on, [explorer, { id: 'agent-2', description: 'Revisar crons', type: 'Explore', status: 'running' }])
    on('tool.call', () => ({ result: 'ok' }))
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    disk(on, '/work', ['/work/freezer/.claude/avatars', '/work/freezer/.git', '/work/gero/.git', '/work/cell/.claude/avatars'], {
      '/work/freezer/.claude/avatars/avatar.png': fakePng(32, 32),
      '/work/freezer/.claude/avatars/avatar.json': '{"nombre":"Freezer"}',
      '/work/cell/.claude/avatars/avatar.png': fakePng(300, 300),
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.turn.start({ text: 'a', turnId: 't1', agentId: 'agent-1' })
    await $.turn.start({ text: 'b', turnId: 't2', agentId: 'agent-2' })
    await $.tool.call({ tool: 'Read', file_path: '/work/freezer/src/a.ts', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Bash', command: 'cd gero && ls', description: 'Listar', agentId: 'agent-2' })
    expect(await legendLine(ui, 'agent-1')).toContain('Freezer · ')
    expect(await legendLine(ui, 'agent-2')).toContain('gero · ')
    await $.tool.call({ tool: 'Read', file_path: '/work/cell/x.ts', agentId: 'agent-2' })
    await $.tool.call({ tool: 'Read', file_path: '/work/cell/y.ts', agentId: 'agent-2' })
    expect(await legendLine(ui, 'agent-2')).toContain('cell · ')
    expect(toasts.filter(text => text.includes('/work/cell/.claude/avatars/avatar.png'))).toHaveLength(1)
    await ui.unmount()
  })

  test('el jefe usa los avatares de la carpeta de la sesión, si los hay', async ($, on) => {
    engine(on, [])
    disk(on, '/work', ['/work/.claude/avatars'], {
      '/work/.claude/avatars/avatar.png': fakePng(32, 32),
      '/work/.claude/avatars/avatar.json': '{"nombre":"Raditz"}',
    })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await legendLine(ui, 'main')).toContain('Raditz · Claude')
    await ui.unmount()
  })

  test('mientras trabaja, el escritorio dibuja un bocadillo con lo que hace', async ($, on) => {
    engine(on, [])
    let during: string | undefined
    let read = async (): Promise<string | undefined> => undefined
    on('tool.call', async () => {
      during = await read()
      return { result: 'ok' }
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    read = async () => (await ui.find({ type: 'Svg' }))?.props.source as string | undefined
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/parser.ts' })
    expect(during).toContain('>Leyendo<')
    expect(during).toContain('>parser.ts<')
    await ui.unmount()
  })

  test("a subagent's turn seats it at work, and its end marks it done", async ($, on) => {
    engine(on, [explorer])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.turn.start({ text: 'Map it', turnId: 't1', agentId: 'agent-1' })
    expect(await legendLine(ui, 'agent-1')).toContain('Pensando')

    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', agentId: 'agent-1', reason: 'answer' })
    expect(await legendLine(ui, 'agent-1')).toContain('terminado')
    await ui.unmount()
  })

  test('a tool call shows on the agent while it runs, and stays as its last one after', async ($, on) => {
    engine(on, [])
    let during: string | undefined
    let read = async (): Promise<string | undefined> => undefined
    on('tool.call', async () => {
      during = await read()
      return { result: 'ok' }
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    read = () => legendLine(ui, 'main')
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/parser.ts' })
    expect(during).toContain('Leyendo parser.ts')
    expect(await legendLine(ui, 'main')).toContain('Leyendo parser.ts')
    await ui.unmount()
  })

  test('an agent of your own type is named by it, and a name it gets later replaces that', async ($, on) => {
    const agents: AgentInfo[] = [{ id: 'agent-2', description: 'Put the prologue in', type: 'story', status: 'running' }]
    const clock = engine(on, agents)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.turn.start({ text: 'Write it', turnId: 't1', agentId: 'agent-2' })
    expect(await legendLine(ui, 'agent-2')).toContain('story')
    expect(await legendLine(ui, 'agent-2')).not.toContain('Put prologue')

    agents[0] = { ...agents[0]!, name: 'narrator' }
    await clock.advance(2000)
    expect(await legendLine(ui, 'agent-2')).toContain('narrator')
    await ui.unmount()
  })

  test('a loop the agent list does not name is left off the floor', async ($, on) => {
    engine(on, [])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.turn.start({ text: '', turnId: 't2', agentId: 'compaction-fork' })
    expect(await legendLine(ui, 'compaction-fork')).toBeUndefined()
    expect(await legendLine(ui, 'main')).toBeDefined()
    await ui.unmount()
  })

  test('/oficina vestir viste a todos los agentes de un tipo', async ($, on) => {
    engine(on, [explorer])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.turn.start({ text: 'Map it', turnId: 't1', agentId: 'agent-1' })
    const { text } = await $.command.run(oficina('vestir Explore color=rosa sombrero=corona extra=gafas-de-sol'))
    expect(text).toContain('Todos los agentes Explore')
    const swatches = (await ui.findAll({ type: 'Text' })).map(found => found.props.color)
    expect(swatches).toContain('#ee7e9b')
    const { text: refused } = await $.command.run(oficina('vestir Explore sombrero=sombrerazo'))
    expect(refused).toContain('sombrero=sombrerazo')
    await ui.unmount()
  })

  test('el detalle de actividad lista las llamadas del agente, agrupadas y con su color', async ($, on) => {
    engine(on, [explorer])
    on('tool.call', ($, e) => (e.tool === 'Bash' ? { deny: 'no' } : { result: 'ok' }))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.turn.start({ text: 'Map it', turnId: 't1', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/b.ts', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Ejecutar tests', agentId: 'agent-1' })
    await ui.press({ key: 'agent-agent-1' })
    expect(await textOf(ui, 'call-0')).toContain('◉ leyendo: a.ts → b.ts  ×2')
    expect((await ui.find({ key: 'call-0' }))?.props.color).toBe('success')
    expect(await textOf(ui, 'call-1')).toContain('$ comando: Ejecutar tests')
    expect((await ui.find({ key: 'call-1' }))?.props.color).toBe('error')
    await ui.press({ key: 'tab-vestir' })
    expect(await ui.find({ key: 'call-0' })).toBeUndefined()
    expect(await ui.find({ key: 'pick-color' })).toBeDefined()
    await ui.unmount()
  })

  test('/oficina despejar borra también el historial de los que se fueron', async ($, on) => {
    const agents: AgentInfo[] = [{ ...explorer }]
    engine(on, agents)
    on('tool.call', () => ({ result: 'ok' }))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.turn.start({ text: 'Map it', turnId: 't1', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'agent-1' })
    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', agentId: 'agent-1', reason: 'answer' })
    expect((await $.command.run(oficina('despejar'))).text).toContain('casa')
    expect(await legendLine(ui, 'agent-1')).toBeUndefined()
    await ui.unmount()
  })

  test('en el escritorio, un agente con avatar de proyecto lleva su PNG en el dibujo', async ($, on) => {
    engine(on, [explorer])
    on('tool.call', () => ({ result: 'ok' }))
    const png = fakePng(32, 32)
    disk(on, '/work', ['/work/freezer/.claude/avatars'], { '/work/freezer/.claude/avatars/avatar.png': png })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.turn.start({ text: 'a', turnId: 't1', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/freezer/a.ts', agentId: 'agent-1' })
    expect((await ui.find({ type: 'Svg' }))?.props.source).toContain(`data:image/png;base64,${base64(png)}`)
    await ui.press({ key: 'agent-agent-1' })
    await ui.press({ key: 'tab-vestir' })
    expect(await textOf(ui, 'avatar-note')).toContain('freezer')
    await ui.unmount()
    const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await terminal.find({ type: 'Raster' })).toBeDefined()
    await terminal.unmount()
  })
})

describe('the pane', () => {
  test('draws a Raster on the terminal and an SVG elsewhere, with a legend', async ($, on) => {
    engine(on, [])
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const picture = surface === 'terminal' ? await ui.find({ type: 'Raster' }) : await ui.find({ type: 'Svg' })
      expect(picture).toBeDefined()
      expect(await ui.find({ key: 'agent-main' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('picking an agent lets you choose its color, hat and extra from lists', async ($, on) => {
    engine(on, [])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'agent-main' })
      await ui.press({ key: 'tab-vestir' })
      expect((await ui.find({ key: 'pick-color' }))?.props.value).toBe('clay')
      await ui.select({ key: 'pick-color', value: 'sky' })
      await ui.select({ key: 'pick-hat', value: 'wizard' })
      expect((await ui.find({ key: 'pick-color' }))?.props.value).toBe('sky')
      expect((await ui.find({ key: 'pick-hat' }))?.props.value).toBe('wizard')
      await ui.press({ key: 'style-reset' })
      expect((await ui.find({ key: 'pick-color' }))?.props.value).toBe('clay')
      await ui.press({ key: 'style-done' })
      expect(await ui.find({ key: 'pick-color' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('mobile, with no lists, steps through the choices with buttons', async ($, on) => {
    engine(on, [])
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'agent-main' })
    await ui.press({ key: 'tab-vestir' })
    expect((await ui.find({ key: 'style-color' }))?.props.label).toBe('Color: arcilla')
    await ui.press({ key: 'style-color' })
    expect((await ui.find({ key: 'style-color' }))?.props.label).toBe('Color: mandarina')
    await ui.unmount()
  })

  test('a look goes to the picked agent alone, or to every agent of its type', async ($, on) => {
    engine(on, [
      explorer,
      { id: 'agent-2', description: 'Find the tests', type: 'Explore', status: 'running' },
    ])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await $.turn.start({ text: 'a', turnId: 't1', agentId: 'agent-1' })
    await $.turn.start({ text: 'b', turnId: 't2', agentId: 'agent-2' })
    const hatOf = async (id: string) => {
      await ui.press({ key: `agent-${id}` })
      await ui.press({ key: 'tab-vestir' })
      const hat = (await ui.find({ key: 'pick-hat' }))?.props.value
      await ui.press({ key: 'style-done' })
      return hat
    }

    await ui.press({ key: 'agent-agent-1' })

    await ui.press({ key: 'tab-vestir' })
    await ui.select({ key: 'pick-hat', value: 'viking' })
    await ui.press({ key: 'style-done' })
    expect(await hatOf('agent-1')).toBe('viking')
    expect(await hatOf('agent-2')).not.toBe('viking')

    await ui.press({ key: 'agent-agent-1' })

    await ui.press({ key: 'tab-vestir' })
    await ui.press({ key: 'scope-type' })
    await ui.select({ key: 'pick-hat', value: 'chef' })
    await ui.press({ key: 'style-done' })
    expect(await hatOf('agent-1')).toBe('chef')
    expect(await hatOf('agent-2')).toBe('chef')
    await ui.unmount()
  })

  test('the terminal draws medium agents unless asked for small or large ones', async ($, on) => {
    engine(on, [])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const columns = async () => (await ui.find({ type: 'Raster' }))?.props.columns
    expect(await columns()).toBe(54)
    expect((await ui.find({ key: 'size' }))?.props.label).toBe('Tamaño: mediano')
    const { text } = await $.command.run(oficina('tamaño pequeño'))
    expect(text).toContain('pequeño')
    expect(await columns()).toBe(42)
    await ui.press({ key: 'size' })
    expect(await columns()).toBe(54)
    await ui.press({ key: 'size' })
    expect(await columns()).toBe(66)
    expect((await $.command.run(oficina('tamaño enorme'))).text).toContain('Uso')
    await ui.unmount()
  })

  test('/oficina aspecto cambia cómo visten los que nadie vistió', async ($, on) => {
    engine(on, [])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: 'looks' }))?.props.label).toBe('Sin vestir: aspecto al azar')
    const { text } = await $.command.run(oficina('aspecto tipo'))
    expect(text).toContain('tipo')
    expect((await ui.find({ key: 'looks' }))?.props.label).toBe('Sin vestir: aspecto por tipo')
    await ui.press({ key: 'looks' })
    expect((await ui.find({ key: 'looks' }))?.props.label).toBe('Sin vestir: aspecto al azar')
    await ui.unmount()
  })

  test('en escritorio la oficina es una imagen a todo el ancho y el tamaño decide las mesas por fila', async ($, on) => {
    engine(on, [])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.source).toContain(`width="${FILL_WIDTH}"`)
    expect(svg?.props.isInteractive).toBeUndefined()
    expect((await ui.find({ key: 'size' }))?.props.label).toBe('Tamaño: mediano')
    await $.command.run(oficina('demo'))
    const viewBox = async () => /viewBox="([^"]+)"/.exec(String((await ui.find({ type: 'Svg' }))?.props.source))?.[1]
    await $.command.run(oficina('tamaño pequeño'))
    const small = await viewBox()
    await $.command.run(oficina('tamaño grande'))
    expect(await viewBox()).not.toBe(small)
    await ui.unmount()
  })
})
