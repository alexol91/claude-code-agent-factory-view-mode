// La decoración del dibujo de escritorio: en la pared, ventanas, pizarra, estantería
// y reloj; en el suelo, plantas y una cafetera en los márgenes, nunca en una mesa.
import type { Canvas } from './scene'
import type { Sprite } from './sprites'

export const WHITEBOARD: Sprite = [
  'ssssssssssss',
  'sWBBBWWWRRWs',
  'sWWWWLLWWWWs',
  'sWBBWWWWBBWs',
  'ssssssssssss',
  '..s......s..',
]

export const BOOKSHELF: Sprite = ['nnnnnnnn', 'nRBYLPBn', 'nnnnnnnn', 'nLOBRYMn', 'nnnnnnnn']

export const CLOCK: Sprite = ['.WWW.', 'WWKWW', 'WWKKW', 'WWWWW', '.WWW.']

export const PLANT: Sprite = ['.L.L.', 'LlLlL', '.lLl.', '..l..', '.NNN.', '.NnN.', '.nnn.']

export const COFFEE: Sprite = ['kkkkk', 'kSSSk', 'kSRSk', 'kkkkk', 'k.W.k', 'kkkkk', 'kkkkk']

/** La ventana de siempre de factory-view, ahora una pieza más de la pared. */
function drawWindow(c: Canvas, x: number): void {
  c.rect(x, 2, 10, 5, 0x8892a6)
  c.rect(x + 1, 3, 8, 3, 0x8ccbea)
  c.set(x + 2, 3, 0xd8f0ff)
  c.set(x + 3, 3, 0xd8f0ff)
  c.set(x + 2, 4, 0xd8f0ff)
  c.rect(x + 5, 3, 1, 3, 0x8892a6)
}

const WALL_PROPS = ['ventana', 'pizarra', 'estanteria', 'ventana'] as const

/** Repartidas a lo ancho de la pared, en los mismos huecos que tenían las ventanas; el reloj, a la derecha si cabe. */
export function drawWallProps(c: Canvas): void {
  const slots = Math.max(1, Math.floor((c.width - 8) / 26))
  const step = c.width / slots
  for (let i = 0; i < slots; i++) {
    const center = Math.round(step * i + step / 2)
    const prop = WALL_PROPS[i % WALL_PROPS.length]!
    if (prop === 'ventana') drawWindow(c, center - 5)
    else if (prop === 'pizarra') c.sprite(center - 6, 2, WHITEBOARD)
    else c.sprite(center - 4, 2, BOOKSHELF)
  }
  const lastRight = Math.round(step * (slots - 0.5)) + 6
  if (c.width - 7 > lastRight + 1) c.sprite(c.width - 7, 2, CLOCK)
}

/** Plantas en tres esquinas y la cafetera en la de arriba a la derecha, en los márgenes. */
export function drawFloorProps(c: Canvas, wall: number): void {
  c.sprite(1, wall + 1, PLANT)
  c.sprite(c.width - 6, wall + 1, COFFEE)
  c.sprite(1, c.height - 8, PLANT)
  c.sprite(c.width - 6, c.height - 8, PLANT)
}
