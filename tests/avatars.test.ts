import { describe, expect, test } from 'claude-code/testing'

import { buildAvatarSet, checkPng, fromBase64, parseAvatarJson, pickFrameFiles } from '../hooks/avatars'
import { base64 } from '../hooks/paint'
import { fakePng } from './fixtures'

describe('los avatares', () => {
  test('elige avatar.png, o los fotogramas numerados hasta el primer hueco', () => {
    expect(pickFrameFiles(['avatar.png', 'avatar.json'])).toEqual(['avatar.png'])
    expect(pickFrameFiles(['avatar.png', 'avatar-1.png', 'avatar-2.png', 'avatar-4.png'])).toEqual(['avatar-1.png', 'avatar-2.png'])
    expect(pickFrameFiles(['otro.png'])).toEqual([])
    expect(pickFrameFiles(Array.from({ length: 14 }, (_, i) => `avatar-${i + 1}.png`))).toHaveLength(12)
  })

  test('un PNG vale si tiene firma e IHDR y mide y pesa lo permitido', () => {
    expect(checkPng(fakePng(32, 32))).toEqual({ ok: true, width: 32, height: 32 })
    expect(checkPng(fakePng(128, 64))).toEqual({ ok: true, width: 128, height: 64 })
    expect(checkPng(fakePng(129, 10)).ok).toBe(false)
    expect(checkPng(fakePng(32, 32, 20 * 1024 + 1)).ok).toBe(false)
    expect(checkPng(Uint8Array.from('GIF89a, que no es un PNG de verdad', c => c.charCodeAt(0))).ok).toBe(false)
  })

  test('avatar.json da nombre y velocidad, e ignora lo que no entiende', () => {
    expect(parseAvatarJson('{"nombre":"Freezer","fps":6}')).toEqual({ name: 'Freezer', fps: 6 })
    expect(parseAvatarJson('{"fps":40,"color":"rojo"}')).toEqual({ fps: 4 })
    expect(parseAvatarJson('{roto')).toBeUndefined()
    expect(parseAvatarJson('[1,2]')).toBeUndefined()
  })

  test('el conjunto exige medidas iguales y como mucho 60 KB', () => {
    const good = buildAvatarSet(
      [
        { file: 'a-1', bytes: fakePng(32, 32) },
        { file: 'a-2', bytes: fakePng(32, 32) },
      ],
      { name: 'Cell', fps: 5 },
    )
    expect(good !== null && 'set' in good ? good.set : undefined).toMatchObject({ name: 'Cell', fps: 5, width: 32, height: 32 })
    expect(good !== null && 'set' in good ? good.set.frames.length : 0).toBe(2)
    const mixed = buildAvatarSet(
      [
        { file: 'a-1', bytes: fakePng(32, 32) },
        { file: 'a-2', bytes: fakePng(16, 16) },
      ],
      undefined,
    )
    expect(mixed).toMatchObject({ file: 'a-2' })
    const heavy = Array.from({ length: 4 }, (_, i) => ({ file: `a-${i}`, bytes: fakePng(32, 32, 16 * 1024) }))
    expect(buildAvatarSet(heavy, undefined)).toMatchObject({ file: 'a-0' })
    expect(buildAvatarSet([], undefined)).toBeNull()
  })

  test('base64 de ida y vuelta', () => {
    const bytes = fakePng(8, 8, 40)
    expect(Array.from(fromBase64(base64(bytes)))).toEqual(Array.from(bytes))
  })
})
