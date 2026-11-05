import { atom, read, update } from 'claude-code'
import type { AgentInfo, Elements, EngineInterface, Register, ToolCallInput } from 'claude-code'

import type { AgentProject, AccessoryName, AgentSize, AgentStatus, AgentStyle, Call, ColorName, FactoryAgent, HatName, LooksMode } from '../types'
import { actionText, activityLines, bubbleLines, callLabel, endCall, familyOf, formatDuration, pruneCalls, startCall } from './activity'
import {
  MAIN_ID,
  STYLE_CHOICES,
  addAgent,
  baseStyle,
  clearFinished,
  cycle,
  describeAgent,
  doingOf,
  endTool,
  labelFor,
  mainAgent,
  parseStyle,
  patchAgent,
  lastingStyles,
  randomStyle,
  setStatus,
  settle,
  startTool,
  styleKey,
  tagOf,
  styleOf,
  toolDetail,
  withMain,
  type NewAgent,
  type StyleScope,
} from './model'
import { buildAvatarSet, fromBase64, MAX_FILE, parseAvatarJson, pickFrameFiles, type AvatarJson, type AvatarSet, type FrameFile } from './avatars'
import { candidateDirs, findProject, normalize, projectName, resolveIn, startOf } from './project'
import { fillScale, fitAvatars, rasterCells, sceneSvg, type SvgAvatar, type SvgBadge, type SvgBubble } from './paint'
import {
  FRAMES,
  avatarBox,
  badgeOf,
  bubbleBox,
  clip,
  colsFor,
  drawScene,
  layout,
  REMOTE_LAYOUT,
  sceneHotspots,
  labelChars,
  sceneLabels,
  seatsNeeded,
  stationOrigin,
  type SceneAgent,
} from './scene'
import { ACCESSORY_NAMES, COLORS, COLOR_NAMES, HAT_NAMES, hex } from './sprites'
import { HELP, SIZE_ES, STATUS_ES, fold, nameOf, sizeOf, type StyleKind } from './texts'

const PANE = 'oficina'
const TITLE = 'Oficina'
const RASTER = 'floor'
/** One animation frame; the SVG plays its frames at the same pace. */
const TICK_MS = 250
const RECONCILE_MS = 2000
const SIZES: AgentSize[] = ['small', 'medium', 'large']
/** Letters in a name tag on the remote surfaces: what fits under a desk and the floor beside it. */
const REMOTE_LABEL_CHARS = 14

const AGENTS = { plugin: 'oficina', key: 'agents' } as const
const agentsAtom = atom(AGENTS, [])
const stylesAtom = atom({ plugin: 'oficina', key: 'styles' } as const, {})
const looksAtom = atom({ plugin: 'oficina', key: 'looks' } as const, 'random')
const sizeAtom = atom({ plugin: 'oficina', key: 'size' } as const, 'medium')
const selectedAtom = atom({ plugin: 'oficina', key: 'selected' } as const, null)
const scopeAtom = atom({ plugin: 'oficina', key: 'scope' } as const, 'agent')
const demoAtom = atom({ plugin: 'oficina', key: 'isDemo' } as const, false)
const callsAtom = atom({ plugin: 'oficina', key: 'calls' } as const, {})
const refreshAtom = atom({ plugin: 'oficina', key: 'refresh' } as const, 0)
const tabAtom = atom({ plugin: 'oficina', key: 'tab' } as const, 'actividad')

type Engine = EngineInterface
/** What every surface draws with; `Select` where the surface has one (not mobile yet). */
type Table = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'> & { Select?: Elements['desktop']['Select'] }
/** The choices that decide how every agent looks. */
type Wardrobe = { styles: Record<string, AgentStyle>; looks: LooksMode }

/** The terminal picture's frame; a reload starts it over, which nobody sees. */
let frame = 0
/** The terminal Raster as last drawn, which the ticker repaints in place. */
let mounted: { columns: number; rows: number; maxCols: number; isFlat: boolean; size: AgentSize } | null = null
let isShown = true
let isTicking = false
/** The selected agent's id as last drawn, so the ticker highlights the same desk. */
let selectedId: string | null = null
/** Loop ids no agent list named lately (the engine's own forks), by when to ask again. */
const unknownUntil = new Map<string, number>()
/** Carpeta → existe: cada carpeta se mira una vez por sesión (spec 4.2). */
const seen = new Map<string, boolean>()
/** Lo que pone cada repo con avatares: su conjunto (o null si no vale) y su nombre. */
type ProjectLook = { set: AvatarSet | null; name: string | undefined }
const projectLooks = new Map<string, ProjectLook>()
/** Ficheros de los que ya se avisó en esta sesión. */
const warned = new Set<string>()
let sessionRoot: string | undefined

/** Olvida lo leído del disco: al cargar el mod, al empezar sesión y con `/oficina recargar`. */
function forgetDisk(): void {
  seen.clear()
  projectLooks.clear()
  warned.clear()
  sessionRoot = undefined
}

async function quietly($: Engine, what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`oficina: ${what} falló: ${String(error)}`, { to: 'debug' })
  }
}

async function rootOf($: Engine): Promise<string> {
  sessionRoot ??= normalize(await $.session.root())
  return sessionRoot
}

async function exists($: Engine, path: string): Promise<boolean> {
  const known = seen.get(path)
  if (known !== undefined) return known
  let isThere = false
  try {
    isThere = await $.fs.exists(path)
  } catch (error) {
    isThere = false
    $.ui.log(`oficina: no se pudo comprobar ${path}: ${String(error)}`, { to: 'debug' })
  }
  seen.set(path, isThere)
  return isThere
}

function warnOnce($: Engine, file: string, reason: string): void {
  if (warned.has(file)) return
  warned.add(file)
  $.ui.toast(`Oficina: ${file} no vale como avatar (${reason})`, { timeoutMs: 8000 })
}

/** Lee `.claude/avatars` de un repo una sola vez: sus fotogramas válidos y su nombre. */
async function lookOf($: Engine, root: string): Promise<ProjectLook> {
  const cached = projectLooks.get(root)
  if (cached !== undefined) return cached
  const look: ProjectLook = { set: null, name: undefined }
  try {
    const dir = `${root}/.claude/avatars`
    const entries = (await $.fs.list(dir)).filter(entry => entry.kind === 'file')
    const names = entries.map(entry => entry.name)
    let json: AvatarJson | undefined
    if (names.includes('avatar.json')) {
      json = parseAvatarJson(String(await $.fs.read(`${dir}/avatar.json`)))
      if (json === undefined) warnOnce($, `${dir}/avatar.json`, 'no es un JSON válido')
    }
    look.name = json?.name
    const frames: FrameFile[] = []
    let tooBig = false
    for (const file of pickFrameFiles(names)) {
      const size = entries.find(entry => entry.name === file)?.size
      if (size !== undefined && size > MAX_FILE) {
        warnOnce($, `${dir}/${file}`, `pesa ${Math.ceil(size / 1024)} KB y el máximo es 20 KB`)
        tooBig = true
        break
      }
      const { base64: data } = await $.fs.read(`${dir}/${file}`, { as: 'bytes' })
      frames.push({ file: `${dir}/${file}`, bytes: fromBase64(data) })
    }
    if (!tooBig) {
      const built = buildAvatarSet(frames, json)
      if (built !== null && 'reason' in built) warnOnce($, built.file, built.reason)
      else if (built !== null) look.set = built.set
    }
  } catch (error) {
    $.ui.log(`oficina: avatares de ${root}: ${String(error)}`, { to: 'debug' })
  }
  projectLooks.set(root, look)
  return look
}

/** El proyecto de una raíz: nombre de avatar.json o de la carpeta. */
async function projectAt($: Engine, root: string, hasAvatars: boolean): Promise<AgentProject> {
  const name = hasAvatars ? (await lookOf($, root)).name : undefined
  return { root, name: name ?? projectName(root), hasAvatars }
}

const sameProject = (a: AgentProject | null, b: AgentProject) =>
  a !== null && a.root === b.root && a.name === b.name && a.hasAvatars === b.hasAvatars

/** Sitúa a un subagente en el proyecto del fichero o carpeta que toca (spec 4). */
async function locate($: Engine, id: string, input: Record<string, unknown>): Promise<void> {
  const start = startOf(input)
  if (start === undefined) return
  const root = await rootOf($)
  const path = resolveIn(root, start.path)
  if (path === undefined) return
  const ref = await findProject(candidateDirs(path, start.isFile, root), p => exists($, p))
  if (ref === null) return
  const project = await projectAt($, ref.root, ref.hasAvatars)
  await mutate($, agents => patchAgent(agents, id, a => (sameProject(a.project, project) ? a : { ...a, project })))
}

/** El jefe solo tiene proyecto si la carpeta de la sesión trae sus propios avatares (spec 4.3). */
async function seatBoss($: Engine): Promise<void> {
  const root = await rootOf($)
  if (!(await exists($, `${root}/.claude/avatars`))) return
  const project = await projectAt($, root, true)
  await mutate($, agents => patchAgent(agents, MAIN_ID, a => (sameProject(a.project, project) ? a : { ...a, project })))
}

/** Changes the agents in one write, or none when nothing changed. */
async function mutate($: Engine, change: (agents: FactoryAgent[], now: number) => FactoryAgent[]): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = await $.clock.now()
    const held = await $.state.get(AGENTS)
    const before = held.value ?? []
    const after = change(withMain(before, now), now)
    if (JSON.stringify(after) === JSON.stringify(before)) return
    const { isSet } = await $.state.set(AGENTS, after, { ifVersion: held.version })
    if (isSet) return
  }
}

/** Los agentes que ya no trabajan: su historial es el primero en irse. */
function finishedIds(agents: readonly FactoryAgent[]): Set<string> {
  return new Set(agents.filter(a => a.status === 'done' || a.status === 'failed' || a.status === 'sleeping').map(a => a.id))
}

/** Manda a casa a los que terminaron, con su historial. */
async function sendHome($: Engine): Promise<void> {
  await mutate($, list => clearFinished(list))
  const keep = new Set(withMain(await read($, agentsAtom), 0).map(a => a.id))
  await update($, callsAtom, calls => pruneCalls(calls, keep))
}

function statusFromList(status: AgentInfo['status']): AgentStatus {
  switch (status) {
    case 'running':
      return 'working'
    case 'completed':
      return 'done'
    case 'failed':
    case 'killed':
      return 'failed'
    default:
      return 'waiting'
  }
}

function newAgentFrom(info: AgentInfo): NewAgent {
  return {
    id: info.id,
    type: info.type,
    label: labelFor(info.name, info.description, info.type),
    description: info.description,
    status: statusFromList(info.status),
    isTeammate: info.teammateId !== undefined,
  }
}

/** Seats the agent a loop id belongs to, if the session lists one; false for the engine's own forks. */
async function ensureAgent($: Engine, id: string): Promise<boolean> {
  if (id === MAIN_ID) return true
  if ((await read($, agentsAtom)).some(a => a.id === id)) return true
  const now = await $.clock.now()
  if ((unknownUntil.get(id) ?? 0) > now) return false
  const info = (await $.agent.list()).find(one => one.id === id)
  if (info === undefined) {
    unknownUntil.set(id, now + 5000)
    return false
  }
  await mutate($, (agents, at) => addAgent(agents, newAgentFrom(info), at))

  return true
}

/** Follows the session's agent list: new agents get desks, ended ones put their feet up. */
async function reconcile($: Engine): Promise<void> {
  await mutate($, (agents, now) => settle(agents, now) ?? agents)

  const listed = await $.agent.list()
  await mutate($, (agents, now) => {
    let next = agents
    for (const info of listed) {
      const mine = next.find(a => a.id === info.id)
      const status = statusFromList(info.status)
      if (mine === undefined) {
        if (status === 'working' || status === 'waiting') next = addAgent(next, newAgentFrom(info), now)
        continue
      }
      const label = labelFor(info.name, info.description, info.type)
      if (mine.label !== label || mine.type !== info.type || mine.description !== info.description) {
        next = patchAgent(next, mine.id, a => ({ ...a, label, type: info.type, description: info.description }))
      }
      const isFresh = now - mine.since < 5000
      const isEnded = status === 'done' || status === 'failed'
      const isMineEnded = mine.status === 'done' || mine.status === 'failed' || mine.status === 'sleeping'
      if ((isEnded && !isMineEnded) || (status === 'working' && mine.status !== 'working' && !isFresh && !isMineEnded)) {
        next = patchAgent(next, mine.id, a => setStatus(a, status, now))
      }
    }
    const ids = new Set(listed.map(info => info.id))
    for (const mine of next) {
      const isGone = !mine.isMain && !mine.isDemo && !ids.has(mine.id) && now - mine.since > 10_000
      if (isGone && (mine.status === 'working' || mine.status === 'waiting')) {
        next = patchAgent(next, mine.id, a => setStatus(a, 'done', now))
      }
    }

    return next
  })

  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  isShown = pane?.isShown === true
  if (await read($, demoAtom)) await demoStep($)
}

/** Repaints the terminal's Raster with the next frame, no render pass. */
async function tick($: Engine): Promise<void> {
  const at = mounted
  if (at === null || !isShown || isTicking) return
  isTicking = true
  try {
    frame = (frame + 1) % (FRAMES * 1000)
    const agents = withMain(await read($, agentsAtom), 0)
    const scene = sceneOf(agents, await wardrobeOf($))
    const selected = agents.find(a => a.id === selectedId)
    const lay = layout(seatsNeeded(scene), at.maxCols, { isFlat: at.isFlat, spacing: 'snug', art: at.size })
    const picture = rasterCells(drawScene(lay, scene, frame, selected?.seat), sceneLabels(lay, scene, labelChars(lay)), lay.isQuad)
    if (picture.columns !== at.columns || picture.rows !== at.rows) return
    await $.ui.blit({ requestId: PANE, key: RASTER, cells: picture.cells, columns: picture.columns, rows: picture.rows })
  } finally {
    isTicking = false
  }
}

async function wardrobeOf($: Engine): Promise<Wardrobe> {
  return { styles: await read($, stylesAtom), looks: await read($, looksAtom) }
}

function sceneOf(agents: readonly FactoryAgent[], { styles, looks }: Wardrobe): SceneAgent[] {
  return agents.map(agent => ({ agent, style: styleOf(agent, styles, looks) }))
}

const DEMO_TYPES = ['Explore', 'general-purpose', 'Plan', 'code-reviewer', 'test-runner', 'docs-writer']
const DEMO_TASKS = ['Mapear el repo', 'Arreglar el parser', 'Planear la API', 'Revisar el diff', 'Ejecutar los tests', 'Escribir la doc']
const DEMO_TOOLS = ['Read', 'Grep', 'Edit', 'Bash', 'WebFetch', 'TodoWrite', 'Glob', 'Write']

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

async function startDemo($: Engine): Promise<void> {
  await update($, demoAtom, () => true)
  await mutate($, (agents, now) =>
    DEMO_TYPES.reduce(
      (list, type, i) =>
        addAgent(
          list,
          {
            id: `demo-${i + 1}`,
            type,
            label: labelFor(undefined, DEMO_TASKS[i]!, type),
            description: DEMO_TASKS[i]!,
            status: i < 3 ? 'working' : i === 3 ? 'waiting' : 'done',
            isDemo: true,
          },
          now,
        ),
      agents,
    ).map(a => (a.isDemo && a.status === 'working' ? { ...a, tool: pick(DEMO_TOOLS), detail: 'demo' } : a)),
  )
}

async function stopDemo($: Engine): Promise<void> {
  await update($, demoAtom, () => false)
  await mutate($, agents => agents.filter(a => !a.isDemo))
}

/** Moves one or two pretend agents along: a new tool, a finished task, a fresh one. */
async function demoStep($: Engine): Promise<void> {
  await mutate($, (agents, now) => {
    const demo = agents.filter(a => a.isDemo)
    if (demo.length === 0) return agents
    let next = agents
    for (let i = 0; i < 2; i++) {
      const one = pick(demo)
      const roll = Math.random()
      next = patchAgent(next, one.id, a => {
        if (a.status !== 'working') return roll < 0.5 ? setStatus(a, 'working', now) : a
        if (roll < 0.15) return setStatus(a, 'done', now)
        if (roll < 0.2) return setStatus(a, 'failed', now)
        if (roll < 0.3) return { ...a, tool: null, toolId: null, detail: null }

        return startTool(a, pick(DEMO_TOOLS), `demo-${now}-${i}`, 'demo', now)
      })
    }

    return next
  })
}

async function select($: Engine, id: string | null): Promise<void> {
  await update($, selectedAtom, current => (current === id ? null : id))
}

/**
 * Changes the look of one agent, or of every agent of its type; a look for
 * the type takes the place of the agent's own, so the picked one shows it.
 * `null` takes the choice back. Choices for types and the manager are kept
 * for later sessions.
 */
async function restyle(
  $: Engine,
  agent: Pick<FactoryAgent, 'id' | 'isMain' | 'type'>,
  scope: StyleScope,
  change: (style: AgentStyle) => AgentStyle | null,
): Promise<void> {
  const key = styleKey(agent, scope)
  const looks = await read($, looksAtom)
  const styles = await update($, stylesAtom, all => {
    const next = { ...all }
    const style = change(baseStyle(agent, scope, all, looks))
    if (scope === 'type') delete next[styleKey(agent, 'agent')]
    if (style === null) delete next[key]
    else next[key] = style

    return next
  })
  await $.store.set('styles', lastingStyles(styles))
}

async function setLooks($: Engine, looks: LooksMode): Promise<void> {
  await update($, looksAtom, () => looks)
  await $.store.set('looks', looks)
}

async function setSize($: Engine, size: AgentSize): Promise<void> {
  await update($, sizeAtom, () => size)
  await $.store.set('size', size)
}

const STATUS_THEME: Record<AgentStatus, string> = {
  working: 'claude',
  waiting: 'warning',
  sleeping: 'inactive',
  done: 'success',
  failed: 'error',
}

function summary(agents: readonly FactoryAgent[]): string {
  const count = (test: (a: FactoryAgent) => boolean) => agents.filter(test).length
  const parts = [
    `${count(a => a.status === 'working')} trabajando`,
    `${count(a => a.status === 'waiting')} esperando`,
    `${count(a => a.status === 'sleeping' || a.status === 'done')} descansando`,
  ]
  const failed = count(a => a.status === 'failed')
  if (failed > 0) parts.push(`${failed} fallaron`)

  return parts.join(' · ')
}

function altText(agents: readonly FactoryAgent[]): string {
  return `${TITLE}: ${agents.map(describeAgent).join('; ')}`.slice(0, 1000)
}

const options = (kind: StyleKind, names: readonly string[]) => names.map(value => ({ value, label: nameOf(kind, value) }))

/** Pickers for color, hat and extra: lists where the surface has them, else buttons that step through. */
function pickers(
  $: Engine,
  { Box, Button, Select }: Table,
  selected: FactoryAgent,
  scope: StyleScope,
  shown: AgentStyle,
) {
  const set = (change: Partial<AgentStyle>) => restyle($, selected, scope, style => ({ ...style, ...change }))
  if (Select !== undefined) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Select
          key="pick-color"
          label="Color"
          options={options('color', COLOR_NAMES)}
          value={shown.color}
          onSelect={value => void set({ color: value as ColorName })}
        />
        <Select
          key="pick-hat"
          label="Sombrero"
          options={options('hat', HAT_NAMES)}
          value={shown.hat}
          onSelect={value => void set({ hat: value as HatName })}
        />
        <Select
          key="pick-extra"
          label="Extra"
          options={options('accessory', ACCESSORY_NAMES)}
          value={shown.accessory}
          onSelect={value => void set({ accessory: value as AccessoryName })}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button
        key="style-color"
        label={`Color: ${nameOf('color', shown.color)}`}
        onPress={() => set({ color: cycle(STYLE_CHOICES.color, shown.color) })}
      />
      <Button key="style-hat" label={`Sombrero: ${nameOf('hat', shown.hat)}`} onPress={() => set({ hat: cycle(STYLE_CHOICES.hat, shown.hat) })} />
      <Button
        key="style-extra"
        label={`Extra: ${nameOf('accessory', shown.accessory)}`}
        onPress={() => set({ accessory: cycle(STYLE_CHOICES.accessory, shown.accessory) })}
      />
    </Box>
  )
}

const CALL_THEME: Record<Call['status'], string> = { running: 'warning', done: 'success', failed: 'error' }

/** La pestaña Actividad: quién es, qué hace y sus últimas llamadas. */
function activityPanel(ui: Table, agent: FactoryAgent, calls: readonly Call[], now: number) {
  const { Box, Text } = ui
  const lines = activityLines(calls)
  const facts = [
    ...(agent.project === null ? [] : [agent.project.name]),
    STATUS_ES[agent.status],
    `desde hace ${formatDuration(now - agent.startedAt)}`,
    `${agent.toolCount} herramientas`,
  ]

  return (
    <Box flexDirection="column">
      <Text weight="bold">{agent.isMain ? 'Claude, el jefe' : agent.label}</Text>
      {agent.description !== '' && <Text dimColor>{agent.description}</Text>}
      <Text dimColor>{facts.join(' · ')}</Text>
      {lines.length === 0 && <Text dimColor>Todavía no ha usado ninguna herramienta.</Text>}
      {lines.map((line, i) => (
        <Text key={`call-${i}`} color={CALL_THEME[line.status]}>
          {line.text}
          <Text dimColor>{`  ${line.duration}`}</Text>
        </Text>
      ))}
    </Box>
  )
}

/** La pestaña Vestir: los controles de aspecto que ya tenía factory-view. */
function dressing(
  $: Engine,
  ui: Table,
  selected: FactoryAgent,
  reach: StyleScope,
  { styles, looks }: Wardrobe,
) {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column" rowGap={1}>
      <Text weight="bold">Vistiendo {selected.isMain ? 'al jefe' : `a ${selected.label}`}</Text>
      {selected.project?.hasAvatars === true && (
        <Text key="avatar-note" dimColor>
          En el escritorio, su aspecto lo pone {selected.project.name} (.claude/avatars); vestirlo solo cambia la terminal.
        </Text>
      )}
      {!selected.isMain && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text dimColor>Para</Text>
          <Button
            key="scope-agent"
            label="este agente"
            variant={reach === 'agent' ? 'primary' : 'secondary'}
            onPress={() => update($, scopeAtom, () => 'agent')}
          />
          <Button
            key="scope-type"
            label={`todos los ${selected.type}`}
            variant={reach === 'type' ? 'primary' : 'secondary'}
            onPress={() => update($, scopeAtom, () => 'type')}
          />
        </Box>
      )}
      {pickers($, ui, selected, reach, baseStyle(selected, reach, styles, looks))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button
          key="style-random"
          label="Al azar"
          onPress={async () => {
            const seed = await $.clock.now()
            await restyle($, selected, reach, () => randomStyle(seed))
          }}
        />
        <Button key="style-reset" label="Restablecer" onPress={() => restyle($, selected, reach, () => null)} />
      </Box>
    </Box>
  )
}

/** The legend under the picture, and the style controls of the agent picked from it. */
function controls(
  $: Engine,
  ui: Table,
  agents: readonly FactoryAgent[],
  wardrobe: Wardrobe,
  selected: FactoryAgent | undefined,
  scope: StyleScope,
  size: AgentSize,
  width: number,
  calls: Record<string, Call[]>,
  tab: 'actividad' | 'vestir',
  now: number,
) {
  const { Box, Text, Button } = ui
  const { styles, looks } = wardrobe
  const sorted = [...agents].sort((a, b) => a.seat - b.seat)
  const hasFinished = agents.some(a => !a.isMain && (a.status === 'done' || a.status === 'failed' || a.status === 'sleeping'))
  const reach: StyleScope = selected?.isMain ? 'type' : scope

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {summary(agents)} · elige un agente para ver qué hace
      </Text>
      {sorted.map(agent => {
        const doing = doingOf(agent)
        return (
          <Button key={`agent-${agent.id}`} plain onPress={() => select($, agent.id)}>
            <Text color={hex(COLORS[styleOf(agent, styles, looks).color])}>■ </Text>
            {clip(tagOf(agent), 26)}{' '}
            <Text color={STATUS_THEME[agent.status]}>{clip(doing, Math.max(10, width - 22))}</Text>
          </Button>
        )
      })}
      {selected !== undefined && (
        <Box flexDirection="column" marginTop={1} rowGap={1}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button
              key="tab-actividad"
              label="Actividad"
              variant={tab === 'actividad' ? 'primary' : 'secondary'}
              onPress={() => update($, tabAtom, () => 'actividad')}
            />
            <Button
              key="tab-vestir"
              label="Vestir"
              variant={tab === 'vestir' ? 'primary' : 'secondary'}
              onPress={() => update($, tabAtom, () => 'vestir')}
            />
            {!selected.isMain && !selected.isDemo && (
              <Button key="style-view" label="Ver transcripción" onPress={() => $.ui.view({ agentId: selected.id })} />
            )}
            <Button key="style-done" label="Listo" variant="primary" onPress={() => select($, null)} />
          </Box>
          {tab === 'actividad'
            ? activityPanel(ui, selected, calls[selected.id] ?? [], now)
            : dressing($, ui, selected, reach, wardrobe)}
        </Box>
      )}
      {selected === undefined && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button
            key="looks"
            label={looks === 'random' ? 'Sin vestir: aspecto al azar' : 'Sin vestir: aspecto por tipo'}
            onPress={() => setLooks($, looks === 'random' ? 'type' : 'random')}
          />
          <Button
            key="size"
            label={`Tamaño: ${SIZE_ES[size]}`}
            onPress={() => setSize($, cycle(SIZES, size))}
          />
          {hasFinished && (
            <Button key="clear-finished" label="Mandar a casa a los que terminaron" onPress={() => sendHome($)} />
          )}
        </Box>
      )}
    </Box>
  )
}

type Target = { agent: Pick<FactoryAgent, 'id' | 'isMain' | 'type'>; scope: StyleScope; name: string }

/** A quién nombra `/oficina vestir`: el jefe, un tipo presente, un agente por su etiqueta o cualquier tipo. */
function targetOf(word: string, agents: readonly FactoryAgent[]): Target {
  if (/^(main|jefe|claude)$/i.test(word)) return { agent: mainAgent(0), scope: 'type', name: 'El jefe' }
  const lower = word.toLowerCase()
  const ofType = agents.find(a => !a.isMain && a.type.toLowerCase() === lower)
  if (ofType !== undefined) return { agent: ofType, scope: 'type', name: `Todos los agentes ${ofType.type}` }
  const tagged = agents.find(a => !a.isMain && a.label.toLowerCase() === lower)
  if (tagged !== undefined) return { agent: tagged, scope: 'agent', name: tagged.label }

  return { agent: { id: '', isMain: false, type: word }, scope: 'type', name: `Todos los agentes ${word}` }
}

async function runCommand($: Engine, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const verb = words[0] === undefined ? undefined : fold(words[0])

  if (verb === undefined || verb === 'abrir' || verb === 'cerrar') {
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (verb !== 'abrir' && pane?.isShown === true) {
      await $.store.set('isClosed', true)
      await $.ui.close({ id: PANE })
      return 'Oficina cerrada; /oficina la vuelve a abrir.'
    }
    await $.store.set('isClosed', false)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return opened.isPlaced ? 'Oficina abierta.' : `La oficina no se pudo abrir: ${opened.reason}`
  }

  const agents = withMain(await read($, agentsAtom), await $.clock.now())

  switch (verb) {
    case 'vestir': {
      const who = words[1]
      if (who === undefined || words.length < 3) return `Uso: /oficina vestir <quién> color=<c> sombrero=<s> extra=<e>\n\n${HELP}`
      const parsed = parseStyle(words.slice(2))
      if ('error' in parsed) return `No entiendo «${parsed.error}». /oficina opciones lista los valores.`
      const target = targetOf(who, agents)
      await restyle($, target.agent, target.scope, style => ({ ...style, ...parsed.change }))
      const { styles, looks } = await wardrobeOf($)
      const style = baseStyle(target.agent, target.scope, styles, looks)
      return `${target.name} lleva ahora: color ${nameOf('color', style.color)}, sombrero ${nameOf('hat', style.hat)}, extra ${nameOf('accessory', style.accessory)}.`
    }
    case 'restablecer': {
      const who = words[1]
      if (who === undefined) {
        await update($, stylesAtom, () => ({}))
        await $.store.set('styles', {})
        return 'Todos los agentes vuelven a su aspecto por defecto.'
      }
      const target = targetOf(who, agents)
      await restyle($, target.agent, target.scope, () => null)
      return `${target.name}: vuelve al aspecto por defecto.`
    }
    case 'tamano': {
      const size = sizeOf(words[1] ?? '')
      if (size === undefined) return 'Uso: /oficina tamaño pequeño|mediano|grande'
      await setSize($, size)
      return `Los agentes se dibujan ahora en tamaño ${SIZE_ES[size]}.`
    }
    case 'aspecto': {
      const mode = fold(words[1] ?? '')
      if (mode !== 'azar' && mode !== 'tipo') return 'Uso: /oficina aspecto azar|tipo'
      await setLooks($, mode === 'azar' ? 'random' : 'type')
      return mode === 'azar'
        ? 'Los agentes que nadie vistió sacan ahora un aspecto al azar.'
        : 'Los agentes que nadie vistió visten ahora según su tipo.'
    }
    case 'despejar':
      await sendHome($)
      return 'Los que terminaron se fueron a casa.'
    case 'demo':
      if (await read($, demoAtom)) {
        await stopDemo($)
        return 'Los agentes de prueba se fueron a casa.'
      }
      await startDemo($)
      await $.ui.open({ id: PANE, title: TITLE })
      return 'Seis agentes de prueba se sentaron en la oficina; /oficina demo los manda a casa.'
    case 'opciones':
      return [
        `Colores: ${COLOR_NAMES.map(id => fold(nameOf('color', id))).join(', ')}`,
        `Sombreros: ${HAT_NAMES.map(id => fold(nameOf('hat', id))).join(', ')}`,
        `Extras: ${ACCESSORY_NAMES.map(id => fold(nameOf('accessory', id))).join(', ')}`,
      ].join('\n')
    case 'recargar':
      forgetDisk()
      await update($, refreshAtom, n => n + 1)
      await seatBoss($)
      return 'Avatares recargados: se vuelven a leer en la próxima llamada de cada agente.'
    default:
      return HELP
  }
}

function isStyles(value: unknown): value is Record<string, AgentStyle> {
  if (typeof value !== 'object' || value === null) return false

  return Object.values(value).every(
    style =>
      typeof style === 'object' &&
      style !== null &&
      (COLOR_NAMES as string[]).includes((style as AgentStyle).color) &&
      (HAT_NAMES as string[]).includes((style as AgentStyle).hat) &&
      (ACCESSORY_NAMES as string[]).includes((style as AgentStyle).accessory),
  )
}

/** Enseña al agente trabajando con una herramienta y la apunta en su historial. */
async function watchTool<E extends ToolCallInput, R>($: Engine, e: E, next: (e: E) => Promise<R>): Promise<R> {
  const id = e.agentId ?? MAIN_ID
  const toolId = e.tool_use_id ?? `${e.tool}-${Math.random()}`
  let isSeated = false
  await quietly($, 'inicio de herramienta', async () => {
    isSeated = await ensureAgent($, id)
    if (!isSeated) return
    if (id !== MAIN_ID) await quietly($, 'proyecto', () => locate($, id, e as unknown as Record<string, unknown>))
    const detail = toolDetail(e.tool, e as unknown as Record<string, unknown>)
    await mutate($, (agents, now) => patchAgent(agents, id, a => startTool(a, e.tool, toolId, detail, now)))
    const start = await $.clock.now()
    const finished = finishedIds(await read($, agentsAtom))
    const call: Call = { id: toolId, tool: e.tool, family: familyOf(e.tool), label: callLabel(e.tool, detail), status: 'running', start }
    await update($, callsAtom, calls => startCall(calls, id, call, finished))
  })
  let isFailed = true
  try {
    const ran = await next(e)
    const result = ran as { deny?: unknown; isError?: unknown } | undefined
    isFailed = result?.deny !== undefined || result?.isError === true
    return ran
  } finally {
    if (isSeated) {
      await quietly($, 'fin de herramienta', async () => {
        const end = await $.clock.now()
        await mutate($, agents => patchAgent(agents, id, a => endTool(a, toolId)))
        await update($, callsAtom, calls => endCall(calls, id, toolId, isFailed ? 'failed' : 'done', end))
      })
    }
  }
}

export const register: Register = on => {
  forgetDisk()
  on('session.start', async ($, e, next) => {
    forgetDisk()
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    $.clock.every(RECONCILE_MS, () => void quietly($, 'reconcile', () => reconcile($)))
    await quietly($, 'styles', async () => {
      const stored = await $.store.get('styles')
      if (isStyles(stored)) await update($, stylesAtom, current => ({ ...stored, ...current }))
      const looks = await $.store.get('looks')
      if (looks === 'random' || looks === 'type') await update($, looksAtom, () => looks)
      const storedSize = await $.store.get('size')
      const size = SIZES.find(one => one === storedSize)
      if (size !== undefined) await update($, sizeAtom, () => size)
      await mutate($, agents => agents)
    })
    await quietly($, 'command', () =>
      $.command.register({
        name: 'oficina',
        description: 'Oficina: mira a tus agentes trabajar en su mesa, qué hace cada uno y en qué proyecto',
        argumentHint: '[abrir|cerrar | vestir <quién> color=… sombrero=… extra=… | restablecer | aspecto | tamaño | despejar | demo | opciones | recargar]',
      }),
    )
    await quietly($, 'open', async () => {
      if ((await $.store.get('isClosed')) !== true) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    })

    await quietly($, 'jefe', () => seatBoss($))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await quietly($, 'clear', async () => {
        const now = await $.clock.now()
        await mutate($, () => [mainAgent(now)])
        await update($, demoAtom, () => false)
        await update($, callsAtom, () => ({}))
        await update($, stylesAtom, lastingStyles)
      })
      await quietly($, 'jefe', () => seatBoss($))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? MAIN_ID
    await quietly($, 'turn start', async () => {
      if (await ensureAgent($, id)) await mutate($, (agents, now) => patchAgent(agents, id, a => setStatus(a, 'working', now)))
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN_ID
    await quietly($, 'turn end', () =>
      mutate($, (agents, now) =>
        patchAgent(agents, id, a => {
          const isError = e.reason === 'error' || e.reason === 'refusal'
          if (isError) return setStatus(a, 'failed', now)
          if (a.isMain || a.isTeammate) return setStatus(a, 'waiting', now)
          if (e.reason === 'aborted') return { ...setStatus(a, 'sleeping', now), outcome: null }

          return setStatus(a, 'done', now)
        }),
      ),
    )

    return next(e)
  })

  // Two hooks, so a subagent's own tool calls, made while the Agent call that
  // started it is still running, do not land in the hook that is waiting on it.
  on('tool.call', { tool: 'Agent' }, ($, e, next) => watchTool($, e, next))
  on('tool.call', { tool: /^(?!Agent$)/ }, ($, e, next) => watchTool($, e, next))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await quietly($, 'close', () => $.store.set('isClosed', true))
    mounted = null

    return next(e)
  })

  on('command.run', { command: 'oficina' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, refreshAtom)
    const agents = withMain(await read($, agentsAtom), 0)
    const wardrobe = await wardrobeOf($)
    const picked = await read($, selectedAtom)
    const scope = await read($, scopeAtom)
    const size = await read($, sizeAtom)
    const calls = await read($, callsAtom)
    const tab = await read($, tabAtom)
    const now = await $.clock.now()
    const selected = agents.find(a => a.id === picked)
    selectedId = selected?.id ?? null
    const scene = sceneOf(agents, wardrobe)
    const seats = seatsNeeded(scene)
    const width = e.props.bodyColumns

    if (e.surface === 'terminal') {
      const ui = $.ui.resolve(e)
      const { Box, Raster } = ui
      const isFlat = e.props.placement === 'inline'
      const maxCols = colsFor(width, 'snug', size)
      const lay = layout(seats, maxCols, { isFlat, spacing: 'snug', art: size })
      const picture = rasterCells(drawScene(lay, scene, frame, selected?.seat), sceneLabels(lay, scene, labelChars(lay)), lay.isQuad)
      mounted = { columns: picture.columns, rows: picture.rows, maxCols, isFlat, size }

      return (
        <Box flexDirection="column">
          <Raster key={RASTER} columns={picture.columns} rows={picture.rows} cells={picture.cells} />
          {controls($, ui, agents, wardrobe, selected, scope, size, width, calls, tab, now)}
        </Box>
      )
    }

    // The remote surfaces draw an SVG that plays its own frames.
    const ui = $.ui.resolve(e)
    const { Box, Svg } = ui
    // The mobile app draws no lists yet: its pickers are buttons.
    const table: Table = e.surface === 'mobile' ? { Box, Text: ui.Text, Button: ui.Button } : ui
    const { maxCols, isWide } = REMOTE_LAYOUT[size]
    const lay = layout(seats, maxCols, { spacing: 'roomy', isWide })
    const bubbles: SvgBubble[] = scene.flatMap(({ agent }) => {
      if (agent.status !== 'working') return []
      const lines = bubbleLines(actionText(agent.tool, agent.detail))
      const box = bubbleBox(lay, agent.seat, lines.length)
      return box === undefined ? [] : [{ ...box, lines }]
    })
    const placements: SvgAvatar[] = []
    for (const { agent } of scene) {
      if (agent.project === null || !agent.project.hasAvatars) continue
      const { set } = await lookOf($, agent.project.root)
      const box = avatarBox(lay, agent.seat)
      if (set === null || box === undefined) continue
      placements.push({ ...box, seat: agent.seat, key: agent.project.root, frames: set.frames, imageWidth: set.width, imageHeight: set.height, fps: set.fps })
    }
    const labels = sceneLabels(lay, scene, REMOTE_LABEL_CHARS)
    const spots = sceneHotspots(lay, scene, describeAgent)
    const source = fitAvatars(placements, avatars => {
      const withAvatar = new Set(avatars.map(a => a.seat))
      const frames = Array.from({ length: FRAMES }, (_, f) =>
        drawScene(lay, scene, f, selected?.seat, { textBubbles: true, avatarSeats: withAvatar }),
      )
      const badges: SvgBadge[] = scene.flatMap(({ agent }) => {
        const badge = withAvatar.has(agent.seat) ? badgeOf(agent) : undefined
        const origin = stationOrigin(lay, agent.seat)
        return badge === undefined || origin === undefined ? [] : [{ ...badge, x: origin.x + 3, y: origin.y + 3 }]
      })
      return sceneSvg(frames, labels, spots, { scale: fillScale(lay.width), secondsPerFrame: TICK_MS / 1000 }, { bubbles, avatars, badges })
    })

    return (
      <Box flexDirection="column" rowGap={1}>
        {/* Sin marco interactivo: ese marco mide unos 150 px de alto y encoge el dibujo; como imagen ocupa el ancho del panel. */}
        <Svg source={source} alt={altText(agents)} />
        {controls($, table, agents, wardrobe, selected, scope, size, width, calls, tab, now)}
      </Box>
    )
  })
}
