import { describe, expect, test } from 'claude-code/testing'

import { ACCESSORY_NAMES, COLOR_NAMES, HAT_NAMES } from '../hooks/sprites'
import { fold, idOf, nameOf, sizeOf } from '../hooks/texts'

describe('los textos', () => {
  test('fold quita tildes y mayúsculas y cambia los espacios por guiones', () => {
    expect(fold(' Gafas de Sol ')).toBe('gafas-de-sol')
    expect(fold('Océano')).toBe('oceano')
    expect(fold('TAMAÑO')).toBe('tamano')
  })

  test('cada color, sombrero y extra tiene un nombre en español que vuelve a su identificador', () => {
    for (const id of COLOR_NAMES) expect(idOf('color', fold(nameOf('color', id)))).toBe(id)
    for (const id of HAT_NAMES) expect(idOf('hat', fold(nameOf('hat', id)))).toBe(id)
    for (const id of ACCESSORY_NAMES) expect(idOf('accessory', fold(nameOf('accessory', id)))).toBe(id)
  })

  test('los tamaños se escriben con o sin tilde', () => {
    expect(sizeOf('pequeño')).toBe('small')
    expect(sizeOf('pequeno')).toBe('small')
    expect(sizeOf('Grande')).toBe('large')
    expect(sizeOf('enorme')).toBeUndefined()
  })
})
