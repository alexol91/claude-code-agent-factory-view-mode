// Writes the factory floor as an animated SVG and as ANSI text, for looking at
// the art outside a session:  bun scripts/preview.ts <out-dir> [agents] [cols]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentStatus, FactoryAgent } from '../types'
import { sceneSvg } from '../hooks/paint'
import { FRAMES, bubbleBox, drawScene, layout, sceneHotspots, sceneLabels, seatsNeeded, type SceneAgent } from '../hooks/scene'
import { defaultStyle } from '../hooks/model'
import { actionText, bubbleLines } from '../hooks/activity'

const out = process.argv[2] ?? '.'
const count = Number(process.argv[3] ?? 8)
const maxCols = Number(process.argv[4] ?? 5)

const kinds: [string, AgentStatus, string | null, FactoryAgent['outcome']][] = [
  ['Explore', 'working', 'Grep', null],
  ['general-purpose', 'working', 'Bash', null],
  ['Plan', 'waiting', null, null],
  ['Explore', 'sleeping', null, 'ok'],
  ['claude-code-guide', 'done', null, 'ok'],
  ['general-purpose', 'failed', null, 'failed'],
  ['reviewer', 'working', 'WebFetch', null],
  ['statusline-setup', 'working', 'Edit', null],
  ['tester', 'working', null, null],
  ['docs', 'working', 'TodoWrite', null],
]

const agent = (id: string, seat: number, type: string, status: AgentStatus, tool: string | null, outcome: FactoryAgent['outcome']): FactoryAgent => ({
  id,
  isMain: seat === 0,
  type,
  label: seat === 0 ? 'Claude' : `${type.slice(0, 7)}-${seat}`,
  description: `demo task ${seat}`,
  project: null,
  status,
  outcome,
  tool,
  detail: null,
  toolId: null,
  since: 0,
  startedAt: 0,
  seat,
  toolCount: 0,
  isTeammate: false,
  isDemo: true,
})

const agents: FactoryAgent[] = [agent('main', 0, 'main', 'working', 'Agent', null)]
for (let i = 1; i <= count; i++) {
  const [type, status, tool, outcome] = kinds[(i - 1) % kinds.length]!
  agents.push(agent(`a${i}`, i, type, status, tool, outcome))
}
const sceneAgents: SceneAgent[] = agents.map(a => ({ agent: a, style: defaultStyle(a, 'random') }))

const lay = layout(seatsNeeded(sceneAgents), maxCols, { spacing: 'roomy' })
const frames = Array.from({ length: FRAMES }, (_, f) => drawScene(lay, sceneAgents, f, undefined, { textBubbles: true }))
const labels = sceneLabels(lay, sceneAgents, 14)
const bubbles = sceneAgents.flatMap(({ agent: a }) => {
  if (a.status !== 'working') return []
  const lines = bubbleLines(actionText(a.tool, 'TaskService.php'))
  const box = bubbleBox(lay, a.seat, lines.length)
  return box === undefined ? [] : [{ ...box, lines }]
})
const svg = sceneSvg(frames, labels, sceneHotspots(lay, sceneAgents, a => a.label), { scale: 3, secondsPerFrame: 0.25 }, { bubbles })
writeFileSync(join(out, 'factory.svg'), svg)
for (const f of [0, 1]) {
  const still = sceneSvg([frames[f]!], labels, [], { scale: 3, secondsPerFrame: 0.25 })
  writeFileSync(join(out, `factory-frame${f}.svg`), still)
}

const c = frames[0]!
let ansi = ''
for (let y = 0; y < c.height; y += 2) {
  for (let x = 0; x < c.width; x++) {
    const top = c.get(x, y)
    const bottom = y + 1 < c.height ? c.get(x, y + 1) : top
    ansi += `\x1b[38;2;${top >> 16};${(top >> 8) & 255};${top & 255}m\x1b[48;2;${bottom >> 16};${(bottom >> 8) & 255};${bottom & 255}m▀`
  }
  ansi += '\x1b[0m\n'
}
writeFileSync(join(out, 'factory.ansi'), ansi)
console.log(`${lay.cols}x${lay.rows} desks, ${c.width}x${c.height} px, svg ${svg.length} chars`)
