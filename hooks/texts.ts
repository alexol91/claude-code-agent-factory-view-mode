import type { AccessoryName, AgentSize, AgentStatus, ColorName, HatName } from '../types'

/** Qué se viste: los identificadores internos no cambian, solo cómo se leen y se escriben. */
export type StyleKind = 'color' | 'hat' | 'accessory'

export const COLOR_ES: Record<ColorName, string> = {
  clay: 'arcilla',
  tangerine: 'mandarina',
  sun: 'sol',
  lime: 'lima',
  mint: 'menta',
  teal: 'turquesa',
  sky: 'cielo',
  ocean: 'océano',
  grape: 'uva',
  berry: 'mora',
  rose: 'rosa',
  snow: 'nieve',
  slate: 'pizarra',
  cocoa: 'cacao',
}

export const HAT_ES: Record<HatName, string> = {
  none: 'ninguno',
  crown: 'corona',
  tophat: 'chistera',
  cap: 'gorra',
  beanie: 'gorro',
  wizard: 'mago',
  party: 'fiesta',
  hardhat: 'casco',
  chef: 'cocinero',
  cowboy: 'vaquero',
  explorer: 'explorador',
  propeller: 'hélice',
  headphones: 'auriculares',
  bow: 'lazo',
  halo: 'aureola',
  antenna: 'antena',
  gradcap: 'birrete',
  viking: 'vikingo',
  sprout: 'brote',
}

export const EXTRA_ES: Record<AccessoryName, string> = {
  none: 'ninguno',
  glasses: 'gafas',
  shades: 'gafas de sol',
  monocle: 'monóculo',
  tie: 'corbata',
  bowtie: 'pajarita',
  mustache: 'bigote',
  scarf: 'bufanda',
  blush: 'rubor',
}

export const STATUS_ES: Record<AgentStatus, string> = {
  working: 'trabajando',
  waiting: 'esperando',
  sleeping: 'durmiendo',
  done: 'terminado',
  failed: 'falló',
}

export const SIZE_ES: Record<AgentSize, string> = { small: 'pequeño', medium: 'mediano', large: 'grande' }

const TABLES: Record<StyleKind, Record<string, string>> = { color: COLOR_ES, hat: HAT_ES, accessory: EXTRA_ES }

/** Como se escribe en un comando: minúsculas, sin tildes y con guiones en lugar de espacios. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
}

/** El nombre en español de un color, sombrero o extra. */
export function nameOf(kind: StyleKind, id: string): string {
  return TABLES[kind][id] ?? id
}

/** El identificador interno de una palabra escrita en un comando, o undefined si no es ninguno. */
export function idOf(kind: StyleKind, word: string): string | undefined {
  const wanted = fold(word)
  return Object.entries(TABLES[kind]).find(([, name]) => fold(name) === wanted)?.[0]
}

export function sizeOf(word: string): AgentSize | undefined {
  const wanted = fold(word)
  return (Object.keys(SIZE_ES) as AgentSize[]).find(size => fold(SIZE_ES[size]) === wanted)
}

export const HELP = [
  '/oficina: abre o cierra el panel de la oficina',
  '/oficina vestir <quién> color=<c> sombrero=<s> extra=<e>: viste al jefe (jefe), a todos los agentes de un tipo o a uno por su etiqueta',
  '/oficina restablecer [quién]: vuelve al aspecto por defecto',
  '/oficina aspecto azar|tipo: cómo visten los agentes que nadie vistió',
  '/oficina tamaño pequeño|mediano|grande: tamaño del dibujo',
  '/oficina despejar: manda a casa a los que terminaron',
  '/oficina demo: añade o quita seis agentes de prueba',
  '/oficina opciones: lista los colores, sombreros y extras',
  '/oficina recargar: vuelve a leer las carpetas .claude/avatars',
].join('\n')
