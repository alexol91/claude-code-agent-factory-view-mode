import type { Call, CallFamily, CallStatus } from '../types'

export const BUBBLE_CHARS = 24
export const BUBBLE_LINE = 15
export const BUBBLE_LINES = 2
export const MAX_PER_AGENT = 40
export const MAX_CALLS = 300

export function familyOf(tool: string): CallFamily {
  if (/^(Bash|BashOutput|PowerShell)$/.test(tool)) return 'bash'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Grep|Glob|LS)$/.test(tool)) return 'search'
  if (/^(WebFetch|WebSearch)$/.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(tool)) return 'agent'
  if (tool.startsWith('mcp__')) return 'mcp'
  return 'other'
}

/** `mcp__plugin_telegram_telegram__reply` → `telegram: reply`. */
function mcpText(tool: string): string {
  const [, server = '', ...action] = tool.split('__')
  const name = server.replace(/^(plugin_|claude_ai_)/, '').replace(/_.*$/, '')
  return `${name}: ${action.join('__')}`
}

/** Lo que hace un agente con una herramienta, dicho en español, sin recortar. */
export function actionText(tool: string | null, detail: string | null): string {
  if (tool === null) return 'Pensando…'
  const d = detail ?? ''
  const on = (verb: string) => (d === '' ? verb : `${verb} ${d}`)
  if (/^(Read|NotebookRead)$/.test(tool)) return on('Leyendo')
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) return on('Editando')
  if (tool === 'Write') return on('Escribiendo')
  if (tool === 'Bash') return d === '' ? 'Ejecutando' : d
  if (tool === 'Grep') return on('Buscando')
  if (tool === 'Glob') return 'Buscando ficheros'
  if (tool === 'WebFetch') return on('Leyendo')
  if (tool === 'WebSearch') return 'Buscando en la web'
  if (tool === 'Agent' || tool === 'Task') return d === '' || d === 'delegando' ? 'Delegando' : `Delegando: ${d}`
  if (tool === 'Skill') return on('Usando')
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(tool)) return 'Planificando'
  if (tool.startsWith('mcp__')) return mcpText(tool)
  return tool
}

/** La etiqueta de una llamada en el historial: su objeto, o la acción entera si no hay uno claro. */
export function callLabel(tool: string, detail: string | null): string {
  const family = familyOf(tool)
  if (family === 'mcp' || family === 'other') return actionText(tool, detail)
  return detail ?? tool
}

/** Recorta a `max` letras por la última palabra entera, con «…». */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(t)
  if (chars.length <= max) return t
  const room = chars.slice(0, max - 1).join('')
  const isAtBoundary = chars[max - 1] === ' '
  const cut = room.lastIndexOf(' ')
  const kept = isAtBoundary ? room : cut > max / 2 ? room.slice(0, cut) : room
  return `${kept.trimEnd()}…`
}

function clipWord(word: string, max: number): string {
  const chars = Array.from(word)
  return chars.length <= max ? word : `${chars.slice(0, max - 1).join('')}…`
}

/** El texto de un bocadillo: como mucho 24 letras en dos líneas de 15. */
export function bubbleLines(text: string): string[] {
  const words = shorten(text, BUBBLE_CHARS)
    .split(' ')
    .map(word => clipWord(word, BUBBLE_LINE))
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current === '' ? word : `${current} ${word}`
    if (Array.from(next).length <= BUBBLE_LINE) {
      current = next
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  if (lines.length <= BUBBLE_LINES) return lines
  const kept = lines.slice(0, BUBBLE_LINES)
  const last = kept[BUBBLE_LINES - 1]!
  kept[BUBBLE_LINES - 1] = last.endsWith('…') ? last : clipWord(`${last}…`, BUBBLE_LINE)
  return kept
}

/** Deja como mucho 300 llamadas: se van primero las más antiguas de los agentes que terminaron. */
export function capCalls(calls: Record<string, Call[]>, finished: ReadonlySet<string>): Record<string, Call[]> {
  const total = Object.values(calls).reduce((n, list) => n + list.length, 0)
  if (total <= MAX_CALLS) return calls
  const order = Object.entries(calls)
    .flatMap(([agent, list]) => list.map(c => ({ agent, c })))
    .sort((x, y) => Number(finished.has(y.agent)) - Number(finished.has(x.agent)) || x.c.start - y.c.start)
  const drop = new Set(order.slice(0, total - MAX_CALLS).map(x => x.c))
  const kept: Record<string, Call[]> = {}
  for (const [agent, list] of Object.entries(calls)) {
    const left = list.filter(c => !drop.has(c))
    if (left.length > 0) kept[agent] = left
  }
  return kept
}

export function startCall(
  calls: Record<string, Call[]>,
  agentId: string,
  call: Call,
  finished: ReadonlySet<string>,
): Record<string, Call[]> {
  const mine = [...(calls[agentId] ?? []), call].slice(-MAX_PER_AGENT)
  return capCalls({ ...calls, [agentId]: mine }, finished)
}

export function endCall(
  calls: Record<string, Call[]>,
  agentId: string,
  id: string,
  status: 'done' | 'failed',
  end: number,
): Record<string, Call[]> {
  const mine = calls[agentId]
  if (mine === undefined) return calls
  return { ...calls, [agentId]: mine.map(c => (c.id === id ? { ...c, status, end } : c)) }
}

/** Solo el historial de los agentes que siguen en la oficina. */
export function pruneCalls(calls: Record<string, Call[]>, keep: ReadonlySet<string>): Record<string, Call[]> {
  return Object.fromEntries(Object.entries(calls).filter(([agent]) => keep.has(agent)))
}

const ICON: Record<CallFamily, string> = { bash: '$', edit: '✎', read: '◉', search: '⌕', web: '◎', agent: '●', mcp: '⌁', other: '·' }
const VERB: Record<CallFamily, string> = {
  bash: 'comando',
  edit: 'editando',
  read: 'leyendo',
  search: 'buscando',
  web: 'web',
  agent: 'delegando',
  mcp: '',
  other: '',
}

export type ActivityLine = { text: string; status: CallStatus; duration: string }

export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  const tenths = Math.round(clamped / 100)
  if (tenths < 100) return `${(tenths / 10).toFixed(1).replace('.', ',')} s`
  const seconds = Math.round(clamped / 1000)
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`
}

/** El historial como líneas: las seguidas de la misma familia se juntan; como mucho `max`, las más recientes. */
export function activityLines(calls: readonly Call[], max = 15): ActivityLine[] {
  const groups: Call[][] = []
  for (const call of calls) {
    const last = groups.at(-1)
    const head = last?.[0]
    const joins = head !== undefined && head.family === call.family && call.family !== 'mcp' && call.family !== 'other'
    if (joins) last!.push(call)
    else groups.push([call])
  }

  return groups.slice(-max).map(group => {
    const first = group[0]!
    const status: CallStatus = group.some(c => c.status === 'running')
      ? 'running'
      : group.some(c => c.status === 'failed')
        ? 'failed'
        : 'done'
    const labels = group.map(c => c.label)
    const shown = labels.length > 4 ? [...labels.slice(0, 3), '…', labels.at(-1)!] : labels
    const count = group.length > 1 ? `  ×${group.length}` : ''
    const verb = VERB[first.family]
    const text = verb === '' ? `${ICON[first.family]} ${shown.join(' → ')}${count}` : `${ICON[first.family]} ${verb}: ${shown.join(' → ')}${count}`
    const start = Math.min(...group.map(c => c.start))
    const end = Math.max(...group.map(c => c.end ?? c.start))
    return { text, status, duration: status === 'running' ? 'en curso' : formatDuration(end - start) }
  })
}
