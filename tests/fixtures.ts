import type { On } from 'claude-code'

import { base64 } from '../hooks/paint'

/** Los primeros bytes de un PNG (firma y cabecera IHDR) con las medidas dadas, rellenos hasta `size` bytes. */
export function fakePng(width: number, height: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 24))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** Un disco de mentira: la carpeta de la sesión, carpetas que existen y ficheros con su contenido. */
export function disk(on: On, root: string, dirs: readonly string[], files: Readonly<Record<string, Uint8Array | string>>): void {
  const bytesOf = (content: Uint8Array | string) => (typeof content === 'string' ? Uint8Array.from(content, c => c.charCodeAt(0)) : content)
  on('session.root', () => ({ value: root }))
  on('fs.exists', ($, e) => ({ value: dirs.includes(e.path) || e.path in files }))
  on('fs.list', ($, e) => ({
    value: Object.keys(files)
      .filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: files[path]!.length, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', ($, e) => {
    const content = files[e.path] ?? ''
    return { value: e.as === 'bytes' ? { base64: base64(bytesOf(content)) } : typeof content === 'string' ? content : '' }
  })
}
