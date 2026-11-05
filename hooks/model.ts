import type { AccessoryName, AgentStatus, AgentStyle, ColorName, FactoryAgent, HatName, LooksMode } from '../types'
import { actionText } from './activity'
import { ACCESSORY_NAMES, COLOR_NAMES, HAT_NAMES } from './sprites'
import { STATUS_ES, fold, idOf } from './texts'

export const MAIN_ID = 'main'
/** Desks beyond the manager's before finished agents are sent home. */
export const MAX_DESKS = 24
/** How long the manager waits for the person before dozing off. */
export const MAIN_DOZE_MS = 90_000
/** How long a finished agent cheers before it dozes off. */
export const DONE_DOZE_MS = 20_000
/** How long a teammate waits for a message before dozing off. */
export const IDLE_DOZE_MS = 60_000

export function mainAgent(now: number): FactoryAgent {
  return {
    id: MAIN_ID,
    isMain: true,
    type: 'main',
    label: 'Claude',
    description: 'La conversación principal: reparte el trabajo.',
    project: null,
    status: 'waiting',
    outcome: null,
    tool: null,
    detail: null,
    toolId: null,
    since: now,
    startedAt: now,
    seat: 0,
    toolCount: 0,
    isTeammate: false,
    isDemo: false,
  }
}

export function withMain(agents: readonly FactoryAgent[], now: number): FactoryAgent[] {
  const all = agents.map(a => ({ ...a, project: a.project ?? null, startedAt: a.startedAt ?? a.since }))
  return all.some(a => a.id === MAIN_ID) ? all : [mainAgent(now), ...all]
}

const isFinished = (a: FactoryAgent) => !a.isMain && (a.status === 'done' || a.status === 'failed' || a.status === 'sleeping')

/** The lowest desk nobody sits at. */
export function freeSeat(agents: readonly FactoryAgent[]): number {
  const taken = new Set(agents.map(a => a.seat))
  let seat = 1
  while (taken.has(seat)) seat++

  return seat
}

export type NewAgent = Pick<FactoryAgent, 'id' | 'type' | 'label' | 'description'> &
  Partial<Pick<FactoryAgent, 'status' | 'isDemo' | 'isTeammate'>>

/**
 * Seats a new agent at the nearest free desk; when the floor is full, the
 * agent that finished longest ago goes home to make room.
 */
export function addAgent(agents: readonly FactoryAgent[], init: NewAgent, now: number): FactoryAgent[] {
  if (agents.some(a => a.id === init.id)) return [...agents]
  let list = [...agents]
  if (freeSeat(list) > MAX_DESKS) {
    const oldest = list.filter(isFinished).sort((a, b) => a.since - b.since)[0]
    if (oldest !== undefined) list = list.filter(a => a.id !== oldest.id)
  }
  const agent: FactoryAgent = {
    ...mainAgent(now),
    id: init.id,
    isMain: false,
    type: init.type,
    label: init.label,
    description: init.description,
    status: init.status ?? 'working',
    seat: freeSeat(list),
    isTeammate: init.isTeammate ?? false,
    isDemo: init.isDemo ?? false,
  }

  return [...list, agent]
}

export function patchAgent(
  agents: readonly FactoryAgent[],
  id: string,
  change: (agent: FactoryAgent) => FactoryAgent,
): FactoryAgent[] {
  return agents.map(a => (a.id === id ? change(a) : a))
}

export function setStatus(agent: FactoryAgent, status: AgentStatus, now: number): FactoryAgent {
  if (agent.status === status) return agent
  const outcome = status === 'done' ? 'ok' : status === 'failed' ? 'failed' : status === 'working' ? null : agent.outcome

  return { ...agent, status, outcome, since: now, ...(status === 'working' ? {} : { tool: null, detail: null, toolId: null }) }
}

export function startTool(agent: FactoryAgent, tool: string, toolId: string, detail: string | null, now: number): FactoryAgent {
  return { ...setStatus(agent, 'working', now), tool, toolId, detail, toolCount: agent.toolCount + 1 }
}

/** A tool that ended stays on show as the agent's last one, until the next starts or the agent stops working. */
export function endTool(agent: FactoryAgent, toolId: string): FactoryAgent {
  return agent.toolId === toolId ? { ...agent, toolId: null } : agent
}

/** Moves on whoever has waited, cheered or idled long enough; null when nobody moved. */
export function settle(agents: readonly FactoryAgent[], now: number): FactoryAgent[] | null {
  let isChanged = false
  const next = agents.map(a => {
    const waited = now - a.since
    const dozes =
      (a.isMain && a.status === 'waiting' && waited > MAIN_DOZE_MS) ||
      (!a.isMain && a.status === 'done' && waited > DONE_DOZE_MS) ||
      (!a.isMain && a.status === 'waiting' && waited > IDLE_DOZE_MS)
    if (!dozes) return a
    isChanged = true

    return { ...setStatus(a, 'sleeping', now), outcome: a.outcome }
  })

  return isChanged ? next : null
}

export function clearFinished(agents: readonly FactoryAgent[]): FactoryAgent[] {
  return agents.filter(a => !isFinished(a))
}

/**
 * Whom a style choice is for: this one agent, or every agent of its type (the
 * manager is one of a kind either way).
 */
export type StyleScope = 'agent' | 'type'

/** Where a style is kept: `agent:<id>` for one agent, `type:<type>` for a type, `main` for the manager. */
export function styleKey(agent: Pick<FactoryAgent, 'id' | 'isMain' | 'type'>, scope: StyleScope): string {
  if (agent.isMain) return 'main'

  return scope === 'agent' ? `agent:${agent.id}` : `type:${agent.type}`
}

/** Choices worth keeping past the session: an agent's own id is not seen again. */
export function lastingStyles(styles: Record<string, AgentStyle>): Record<string, AgentStyle> {
  return Object.fromEntries(Object.entries(styles).filter(([key]) => !key.startsWith('agent:')))
}

const MANAGER: AgentStyle = { color: 'clay', hat: 'crown', accessory: 'tie' }

const KNOWN: Record<string, AgentStyle> = {
  Explore: { color: 'sky', hat: 'explorer', accessory: 'none' },
  'general-purpose': { color: 'mint', hat: 'hardhat', accessory: 'none' },
  Plan: { color: 'grape', hat: 'wizard', accessory: 'glasses' },
  'claude-code-guide': { color: 'teal', hat: 'gradcap', accessory: 'glasses' },
  'statusline-setup': { color: 'rose', hat: 'propeller', accessory: 'blush' },
  fork: { color: 'clay', hat: 'cap', accessory: 'none' },
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }

  return h
}

/** The manager's color and crown stay the manager's: nobody else draws them by chance. */
const CHANCE_COLORS = COLOR_NAMES.filter(c => c !== 'clay')
const CHANCE_HATS = HAT_NAMES.filter(name => name !== 'crown')

/** A look drawn by lot from `seed`: the same seed, the same look. */
export function randomStyle(seed: string | number): AgentStyle {
  const h = hash(String(seed))
  const extras = ACCESSORY_NAMES.filter(name => name !== 'none')

  return {
    color: CHANCE_COLORS[h % CHANCE_COLORS.length]!,
    hat: CHANCE_HATS[(h >>> 8) % CHANCE_HATS.length]!,
    accessory: (h >>> 16) % 2 === 0 ? 'none' : extras[(h >>> 20) % extras.length]!,
  }
}

/** A look of its own for every agent type, the same every session. */
export function typeStyle(type: string): AgentStyle {
  return KNOWN[type] ?? randomStyle(`type:${type}`)
}

/**
 * How an agent looks before anyone picks: the manager as the manager; the
 * others by lot, each its own (`random`), or dressed for their type (`type`).
 */
export function defaultStyle(agent: Pick<FactoryAgent, 'id' | 'isMain' | 'type'>, looks: LooksMode = 'random'): AgentStyle {
  if (agent.isMain) return MANAGER

  return looks === 'random' ? randomStyle(`agent:${agent.id}`) : typeStyle(agent.type)
}

/** The look chosen for this agent, else for its type, else its default. */
export function styleOf(
  agent: Pick<FactoryAgent, 'id' | 'isMain' | 'type'>,
  styles: Record<string, AgentStyle>,
  looks: LooksMode = 'random',
): AgentStyle {
  return styles[styleKey(agent, 'agent')] ?? styles[styleKey(agent, 'type')] ?? defaultStyle(agent, looks)
}

/** What a scope shows before a choice is made there: the type's look for a type, the agent's own for an agent. */
export function baseStyle(
  agent: Pick<FactoryAgent, 'id' | 'isMain' | 'type'>,
  scope: StyleScope,
  styles: Record<string, AgentStyle>,
  looks: LooksMode,
): AgentStyle {
  return scope === 'agent' ? styleOf(agent, styles, looks) : (styles[styleKey(agent, 'type')] ?? defaultStyle(agent, looks))
}

export function cycle<T>(list: readonly T[], current: T, step = 1): T {
  const at = list.indexOf(current)

  return list[(at + step + list.length) % list.length]!
}

export type StyleField = 'color' | 'hat' | 'accessory'

export const STYLE_CHOICES: { color: ColorName[]; hat: HatName[]; accessory: AccessoryName[] } = {
  color: COLOR_NAMES,
  hat: HAT_NAMES,
  accessory: ACCESSORY_NAMES,
}

/**
 * Lee `color=cielo sombrero=corona extra=corbata` (en cualquier orden, con o sin
 * tildes) como un cambio de aspecto, o devuelve la primera palabra que no entiende.
 */
export function parseStyle(words: readonly string[]): { change: Partial<AgentStyle> } | { error: string } {
  const change: Partial<AgentStyle> = {}
  for (const word of words) {
    const [rawKey = '', rawValue = ''] = word.split('=')
    const key = fold(rawKey)
    if (key === 'color') {
      const id = idOf('color', rawValue)
      if (id === undefined) return { error: word }
      change.color = id as ColorName
    } else if (key === 'sombrero') {
      const id = idOf('hat', rawValue)
      if (id === undefined) return { error: word }
      change.hat = id as HatName
    } else if (key === 'extra') {
      const id = idOf('accessory', rawValue)
      if (id === undefined) return { error: word }
      change.accessory = id as AccessoryName
    } else {
      return { error: word }
    }
  }

  return { change }
}

/** A few words on what a tool call works on, read off its input. */
export function toolDetail(tool: string, input: Record<string, unknown>): string | null {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  const base = (path: string | undefined) => path?.split(/[\\/]/).filter(Boolean).pop()
  if (tool === 'Bash') {
    const command = text('command')
    const description = text('description')?.trim() || undefined
    const said = description ?? (command === undefined ? undefined : `Ejecutando ${command}`)
    return said === undefined ? null : said.replace(/\s+/g, ' ').trim().slice(0, 60)
  }
  const detail =
    text('description') ??
    text('command') ??
    base(text('file_path')) ??
    base(text('notebook_path')) ??
    text('pattern') ??
    text('query') ??
    hostOf(text('url')) ??
    text('skill') ??
    text('subject')
  if (detail === undefined || detail.trim() === '') return tool === 'Agent' ? 'delegando' : null

  return detail.replace(/\s+/g, ' ').trim().slice(0, 60)
}

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The agent types Claude Code ships with: they say little about one agent, so its task names it instead. */
const BUILT_IN_TYPES = new Set([
  'general-purpose',
  'Explore',
  'Plan',
  'fork',
  'teammate',
  'statusline-setup',
  'claude-code-guide',
  'output-style-setup',
])

/**
 * The name on a subagent's desk: its call name, else its type when it is one
 * of your own agents (a plugin's without the plugin), else the first words of
 * its task that say something, else its type.
 */
export function labelFor(name: string | undefined, description: string, type: string): string {
  if (name !== undefined && name !== '') return name
  const own = type.slice(type.lastIndexOf(':') + 1)
  if (own !== '' && !BUILT_IN_TYPES.has(type)) return own
  const words = description
    .trim()
    .split(/\s+/)
    .filter(word => word !== '' && !/^(the|a|an|to|of|for|and|in|on|at|with|el|la|los|las|un|una|de|del|y|en|con|para|por|al)$/i.test(word))
    .slice(0, 2)
    .join(' ')

  return words !== '' ? words : type
}

/** Qué está haciendo un agente ahora, en español. */
export function doingOf(agent: FactoryAgent): string {
  if (agent.status === 'working') return actionText(agent.tool, agent.detail)
  if (agent.status === 'sleeping' && agent.outcome === 'ok') return 'terminado, dormitando'
  return STATUS_ES[agent.status]
}

/** Una línea sobre un agente, para el texto al pasar el ratón por su mesa. */
export function describeAgent(agent: FactoryAgent): string {
  return `${agent.label} (${agent.isMain ? 'jefe' : agent.type}) · ${doingOf(agent)}`
}

/** La etiqueta de la mesa: «proyecto · nombre», o solo el nombre. */
export function tagOf(agent: Pick<FactoryAgent, 'label' | 'project'>): string {
  return agent.project === null ? agent.label : `${agent.project.name} · ${agent.label}`
}
