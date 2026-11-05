// Los avatares de un proyecto: qué ficheros de .claude/avatars se usan y si valen.
// Sin `$`: register.tsx lee los ficheros y pasa aquí sus bytes.
import { base64 } from './paint'

export const MAX_SIDE = 128
export const MAX_FILE = 20 * 1024
export const MAX_SET = 60 * 1024
export const MAX_FRAMES = 12
export const DEFAULT_FPS = 4

export type AvatarSet = { name?: string; fps: number; width: number; height: number; frames: string[] }
export type AvatarJson = { name?: string; fps: number }
export type FrameFile = { file: string; bytes: Uint8Array }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** `avatar-1.png…` seguidos desde 1 (hasta 12, se para en el primer hueco), o si no `avatar.png`. */
export function pickFrameFiles(names: readonly string[]): string[] {
  const present = new Set(names)
  if (present.has('avatar-1.png')) {
    const frames: string[] = []
    for (let i = 1; i <= MAX_FRAMES && present.has(`avatar-${i}.png`); i++) frames.push(`avatar-${i}.png`)
    return frames
  }
  return present.has('avatar.png') ? ['avatar.png'] : []
}

export function checkPng(bytes: Uint8Array): { ok: true; width: number; height: number } | { ok: false; reason: string } {
  if (bytes.length > MAX_FILE) return { ok: false, reason: `pesa ${Math.ceil(bytes.length / 1024)} KB y el máximo es 20 KB` }
  if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b)) return { ok: false, reason: 'no es un PNG' }
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return { ok: false, reason: 'no es un PNG' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width === 0 || height === 0 || width > MAX_SIDE || height > MAX_SIDE) {
    return { ok: false, reason: `mide ${width}×${height} px y el máximo es 128×128` }
  }
  return { ok: true, width, height }
}

/** `{ "nombre": "Freezer", "fps": 4 }`; un campo que no se entiende se ignora; un JSON roto, undefined. */
export function parseAvatarJson(text: string): AvatarJson | undefined {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const raw = value as Record<string, unknown>
    const name = typeof raw.nombre === 'string' && raw.nombre.trim() !== '' ? raw.nombre.trim().slice(0, 24) : undefined
    const fps = typeof raw.fps === 'number' && Number.isInteger(raw.fps) && raw.fps >= 1 && raw.fps <= 12 ? raw.fps : DEFAULT_FPS
    return name === undefined ? { fps } : { name, fps }
  } catch {
    return undefined
  }
}

/** El conjunto de un repo, o el fichero que lo invalida y por qué; null si no hay fotogramas. */
export function buildAvatarSet(
  frames: readonly FrameFile[],
  json: AvatarJson | undefined,
): { set: AvatarSet } | { file: string; reason: string } | null {
  if (frames.length === 0) return null
  let total = 0
  let size: { width: number; height: number } | undefined
  for (const frame of frames) {
    const check = checkPng(frame.bytes)
    if (!check.ok) return { file: frame.file, reason: check.reason }
    if (size !== undefined && (check.width !== size.width || check.height !== size.height)) {
      return { file: frame.file, reason: `mide ${check.width}×${check.height} px y el primer fotograma ${size.width}×${size.height}` }
    }
    size ??= { width: check.width, height: check.height }
    total += frame.bytes.length
  }
  if (total > MAX_SET) return { file: frames[0]!.file, reason: `los fotogramas suman ${Math.ceil(total / 1024)} KB y el máximo es 60 KB` }
  const set: AvatarSet = { fps: json?.fps ?? DEFAULT_FPS, width: size!.width, height: size!.height, frames: frames.map(f => base64(f.bytes)) }
  if (json?.name !== undefined) set.name = json.name
  return { set }
}

export function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), c => c.charCodeAt(0))
}
