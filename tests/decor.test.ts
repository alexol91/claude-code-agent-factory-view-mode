import { describe, expect, test } from 'claude-code/testing'

import { sceneSvg, SVG_LIMIT } from '../hooks/paint'
import { addAgent, defaultStyle, mainAgent } from '../hooks/model'
import { drawScene, layout, stationOrigin } from '../hooks/scene'
import { INK } from '../hooks/sprites'
import type { FactoryAgent } from '../types'

describe('la decoración', () => {
  const has = (c: ReturnType<typeof drawScene>, x0: number, y0: number, w: number, h: number, color: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (c.get(x, y) === color) return true
    return false
  }

  test('la pared lleva pizarra y el suelo plantas y cafetera, en el dibujo de escritorio', () => {
    const lay = layout(9, 7, { spacing: 'roomy' })
    const c = drawScene(lay, [], 0)
    expect(has(c, 0, 0, lay.width, lay.wall, INK.W!)).toBe(true)
    expect(has(c, 0, lay.wall + 1, 7, 7, INK.L!)).toBe(true)
    expect(has(c, lay.width - 7, lay.wall + 1, 7, 7, INK.k!)).toBe(true)
    expect(has(c, 0, lay.height - 9, 7, 8, INK.L!)).toBe(true)
    expect(has(c, lay.width - 7, lay.height - 9, 7, 8, INK.L!)).toBe(true)
  })

  test('las plantas y la cafetera quedan fuera de las mesas', () => {
    const lay = layout(9, 7, { spacing: 'roomy' })
    for (let seat = 0; seat < 9; seat++) {
      const origin = stationOrigin(lay, seat)!
      expect(origin.x).toBeGreaterThanOrEqual(7)
      expect(origin.x + lay.deskW).toBeLessThanOrEqual(lay.width - 7)
    }
  })

  test('sin hueco a los lados no se pone nada en el suelo', () => {
    const lay = layout(9, 7)
    expect(has(drawScene(lay, [], 0), 0, lay.wall + 1, 3, 7, INK.L!)).toBe(false)
  })

  test('con 25 agentes y decoración, el SVG sigue cabiendo', () => {
    let agents: FactoryAgent[] = [mainAgent(0)]
    for (let i = 1; i <= 24; i++) agents = addAgent(agents, { id: `a${i}`, type: `t${i}`, label: `a${i}`, description: '' }, 0)
    const scene = agents.map(agent => ({ agent, style: defaultStyle(agent) }))
    const lay = layout(25, 7, { spacing: 'roomy' })
    const frames = Array.from({ length: 8 }, (_, f) => drawScene(lay, scene, f))
    expect(sceneSvg(frames, [], [], { scale: 1.5, secondsPerFrame: 0.25 }).length).toBeLessThanOrEqual(SVG_LIMIT)
  })
})
