// Del fichero que toca un agente al proyecto (repo) donde trabaja. Sin `$`: las
// comprobaciones de disco llegan como función desde register.tsx.

export type ProjectRef = { root: string; hasAvatars: boolean }

/** Resuelve '.' y '..', quita barras repetidas y la del final. */
export function normalize(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${isAbsolute ? '/' : ''}${parts.join('/')}`
}

/** La ruta absoluta, si cae dentro de la carpeta de la sesión; undefined si no. */
export function resolveIn(root: string, path: string): string | undefined {
  if (path.startsWith('~')) return undefined
  const base = normalize(root)
  const full = normalize(path.startsWith('/') ? path : `${base}/${path}`)
  return full === base || full.startsWith(`${base}/`) ? full : undefined
}

/** La carpeta de un `cd` al principio de un comando. */
export function cdTarget(command: string): string | undefined {
  const match = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;|\||$)/.exec(command)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

/** De dónde se parte: un fichero (se sube desde su carpeta) o una carpeta. */
export function startOf(input: Record<string, unknown>): { path: string; isFile: boolean } | undefined {
  const text = (key: string) => (typeof input[key] === 'string' && input[key] !== '' ? (input[key] as string) : undefined)
  const file = text('file_path') ?? text('notebook_path')
  if (file !== undefined) return { path: file, isFile: true }
  const dir = text('path')
  if (dir !== undefined) return { path: dir, isFile: false }
  if (input.tool === 'Bash') {
    const cd = cdTarget(text('command') ?? '')
    if (cd !== undefined) return { path: cd, isFile: false }
  }
  return undefined
}

/** Las carpetas a mirar, de dentro a fuera, hasta la de la sesión incluida. */
export function candidateDirs(start: string, isFile: boolean, root: string): string[] {
  const base = normalize(root)
  let dir = isFile ? start.slice(0, Math.max(start.lastIndexOf('/'), 0)) || '/' : start
  const dirs: string[] = []
  while (dir === base || dir.startsWith(`${base}/`)) {
    dirs.push(dir)
    if (dir === base) break
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  return dirs
}

/** La primera carpeta con `.claude/avatars` o con `.git`, de dentro a fuera. */
export async function findProject(dirs: readonly string[], exists: (path: string) => Promise<boolean>): Promise<ProjectRef | null> {
  for (const dir of dirs) {
    if (await exists(`${dir}/.claude/avatars`)) return { root: dir, hasAvatars: true }
    if (await exists(`${dir}/.git`)) return { root: dir, hasAvatars: false }
  }
  return null
}

export function projectName(root: string): string {
  return root.slice(root.lastIndexOf('/') + 1)
}
