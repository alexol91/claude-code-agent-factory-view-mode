import { describe, expect, test } from 'claude-code/testing'

import type { Call } from '../types'
import {
  actionText,
  activityLines,
  bubbleLines,
  callLabel,
  endCall,
  familyOf,
  formatDuration,
  pruneCalls,
  shorten,
  startCall,
} from '../hooks/activity'

const call = (id: string, tool: string, label: string, start: number, extra: Partial<Call> = {}): Call => ({
  id,
  tool,
  family: familyOf(tool),
  label,
  status: 'done',
  start,
  end: start + 400,
  ...extra,
})

describe('los bocadillos', () => {
  test('cada herramienta se dice en español', () => {
    expect(actionText('Read', 'parser.ts')).toBe('Leyendo parser.ts')
    expect(actionText('NotebookRead', 'n.ipynb')).toBe('Leyendo n.ipynb')
    expect(actionText('Edit', 'a.ts')).toBe('Editando a.ts')
    expect(actionText('Write', 'b.ts')).toBe('Escribiendo b.ts')
    expect(actionText('Bash', 'Ejecutar tests')).toBe('Ejecutar tests')
    expect(actionText('Bash', null)).toBe('Ejecutando')
    expect(actionText('Grep', 'calcularIva')).toBe('Buscando calcularIva')
    expect(actionText('Glob', '**/*.ts')).toBe('Buscando ficheros')
    expect(actionText('WebFetch', 'docs.example.com')).toBe('Leyendo docs.example.com')
    expect(actionText('WebSearch', 'algo')).toBe('Buscando en la web')
    expect(actionText('Agent', 'Revisar tests')).toBe('Delegando: Revisar tests')
    expect(actionText('Agent', 'delegando')).toBe('Delegando')
    expect(actionText('Skill', 'pdf')).toBe('Usando pdf')
    expect(actionText('TodoWrite', null)).toBe('Planificando')
    expect(actionText('mcp__plugin_telegram_telegram__reply', null)).toBe('telegram: reply')
    expect(actionText('AskUserQuestion', null)).toBe('AskUserQuestion')
    expect(actionText(null, null)).toBe('Pensando…')
  })

  test('un texto largo se corta por palabra con puntos suspensivos', () => {
    expect(shorten('Ejecutando los tests de facturación completos', 24)).toBe('Ejecutando los tests de…')
    expect(shorten('x TaskServiceImpl1 abcdef', 24)).toBe('x TaskServiceImpl1…')
    expect(shorten('corto', 24)).toBe('corto')
  })

  test('el bocadillo cabe en dos líneas de 15 letras', () => {
    expect(bubbleLines('Leyendo TaskService.php')).toEqual(['Leyendo', 'TaskService.php'])
    expect(bubbleLines('Pensando…')).toEqual(['Pensando…'])
    for (const text of ['x TaskServiceImpl1 abcdef', 'Ejecutando los tests de facturación', 'UnNombreDeFicheroLarguisimo.ts', 'a bbbbbbbbbbbbbbb cccccc']) {
      const lines = bubbleLines(text)
      expect(lines.length).toBeLessThanOrEqual(2)
      for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(15)
    }
  })
})

describe('el historial', () => {
  test('cada agente guarda como mucho 40 llamadas', () => {
    let calls: Record<string, Call[]> = {}
    for (let i = 0; i < 45; i++) calls = startCall(calls, 'a1', call(`c${i}`, 'Read', `f${i}.ts`, i), new Set())
    expect(calls.a1!.length).toBe(40)
    expect(calls.a1![0]!.id).toBe('c5')
  })

  test('pasadas 300, se borran primero las más antiguas de los agentes que terminaron', () => {
    let calls: Record<string, Call[]> = {}
    for (let agent = 0; agent < 8; agent++) {
      for (let i = 0; i < 40; i++) calls = startCall(calls, `a${agent}`, call(`a${agent}-c${i}`, 'Read', 'x', agent * 100 + i), new Set(['a5']))
    }
    expect(Object.values(calls).reduce((n, list) => n + list.length, 0)).toBe(300)
    expect(calls.a5!.length).toBe(20)
    expect(calls.a5![0]!.id).toBe('a5-c20')
    expect(calls.a0!.length).toBe(40)
  })

  test('una llamada se cierra bien o mal, y despejar quita a los que se fueron', () => {
    let calls = startCall({}, 'a1', call('c1', 'Read', 'a.ts', 0, { status: 'running', end: undefined }), new Set())
    calls = endCall(calls, 'a1', 'c1', 'failed', 900)
    expect(calls.a1![0]).toMatchObject({ status: 'failed', end: 900 })
    expect(pruneCalls({ ...calls, a2: [] }, new Set(['a2']))).toEqual({ a2: [] })
  })

  test('las llamadas seguidas del mismo tipo se agrupan en una línea', () => {
    const lines = activityLines([
      call('1', 'Read', 'a.ts', 0),
      call('2', 'Read', 'b.ts', 1000),
      call('3', 'Read', 'c.ts', 2000),
      call('4', 'Bash', 'Ejecutar tests', 3000, { status: 'failed' }),
      call('5', 'Edit', 'a.ts', 4000, { status: 'running', end: undefined }),
      call('6', 'mcp__plugin_telegram_telegram__reply', callLabel('mcp__plugin_telegram_telegram__reply', null), 5000),
    ])
    expect(lines.map(l => l.text)).toEqual([
      '◉ leyendo: a.ts → b.ts → c.ts  ×3',
      '$ comando: Ejecutar tests',
      '✎ editando: a.ts',
      '⌁ telegram: reply',
    ])
    expect(lines.map(l => l.status)).toEqual(['done', 'failed', 'running', 'done'])
    expect(lines[0]!.duration).toBe('2,4 s')
    expect(lines[2]!.duration).toBe('en curso')
  })

  test('un grupo de más de cuatro enseña los tres primeros y el último', () => {
    const many = Array.from({ length: 6 }, (_, i) => call(`${i}`, 'Read', `f${i}`, i))
    expect(activityLines(many)[0]!.text).toBe('◉ leyendo: f0 → f1 → f2 → … → f5  ×6')
  })

  test('como mucho 15 líneas, las más recientes', () => {
    const mixed = Array.from({ length: 20 }, (_, i) => call(`${i}`, i % 2 === 0 ? 'Read' : 'Edit', `f${i}`, i))
    const lines = activityLines(mixed)
    expect(lines.length).toBe(15)
    expect(lines.at(-1)!.text).toBe('✎ editando: f19')
  })

  test('las duraciones se dicen en segundos o minutos', () => {
    expect(formatDuration(400)).toBe('0,4 s')
    expect(formatDuration(12_300)).toBe('12 s')
    expect(formatDuration(75_000)).toBe('1 min 15 s')
    expect(formatDuration(59_600)).toBe('1 min 00 s')
    expect(formatDuration(119_600)).toBe('2 min 00 s')
    expect(formatDuration(9_960)).toBe('10 s')
  })
})
