import { describe, expect, test } from 'claude-code/testing'

import { candidateDirs, cdTarget, findProject, normalize, projectName, resolveIn, startOf } from '../hooks/project'

describe('el proyecto de cada ruta', () => {
  test('normaliza rutas', () => {
    expect(normalize('/work//a/./b/../c/')).toBe('/work/a/c')
    expect(normalize('/')).toBe('/')
  })

  test('una ruta relativa se resuelve dentro de la sesión, y una de fuera no cuenta', () => {
    expect(resolveIn('/work', 'repo-b/x.ts')).toBe('/work/repo-b/x.ts')
    expect(resolveIn('/work', '/work/repo-b/x.ts')).toBe('/work/repo-b/x.ts')
    expect(resolveIn('/work', '/etc/hosts')).toBeUndefined()
    expect(resolveIn('/work', '../fuera/x.ts')).toBeUndefined()
    expect(resolveIn('/work', '~/x.ts')).toBeUndefined()
    expect(resolveIn('/work', '/workshop/x.ts')).toBeUndefined()
    expect(resolveIn('/home/dev/mis proyectos', 'repo-c/a.ts')).toBe('/home/dev/mis proyectos/repo-c/a.ts')
  })

  test('lee el cd del principio de un comando, con o sin comillas', () => {
    expect(cdTarget('cd repo-b && npm test')).toBe('repo-b')
    expect(cdTarget('cd "mis proyectos/repo-d"; ls')).toBe('mis proyectos/repo-d')
    expect(cdTarget("cd '/work/x'")).toBe('/work/x')
    expect(cdTarget('npm test && cd x')).toBeUndefined()
  })

  test('saca la ruta de la herramienta: fichero, carpeta o cd', () => {
    expect(startOf({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ path: '/w/a.ts', isFile: true })
    expect(startOf({ tool: 'NotebookEdit', notebook_path: '/w/n.ipynb' })).toEqual({ path: '/w/n.ipynb', isFile: true })
    expect(startOf({ tool: 'Grep', pattern: 'x', path: '/w/src' })).toEqual({ path: '/w/src', isFile: false })
    expect(startOf({ tool: 'Bash', command: 'cd /w/gero && ls' })).toEqual({ path: '/w/gero', isFile: false })
    expect(startOf({ tool: 'Bash', command: 'ls' })).toBeUndefined()
    expect(startOf({ tool: 'WebSearch', query: 'x' })).toBeUndefined()
  })

  test('las carpetas a mirar van de dentro a fuera hasta la de la sesión', () => {
    expect(candidateDirs('/work/a/b/c.ts', true, '/work')).toEqual(['/work/a/b', '/work/a', '/work'])
    expect(candidateDirs('/work/a', false, '/work')).toEqual(['/work/a', '/work'])
    expect(candidateDirs('/work/c.ts', true, '/work')).toEqual(['/work'])
    expect(candidateDirs('/otra/a.ts', true, '/work')).toEqual([])
  })

  test('gana la carpeta más cercana con avatares o con .git', async () => {
    const present = new Set(['/work/.claude/avatars', '/work/freezer/.claude/avatars', '/work/freezer/.git', '/work/gero/.git'])
    const exists = async (path: string) => present.has(path)
    expect(await findProject(['/work/freezer/src', '/work/freezer', '/work'], exists)).toEqual({ root: '/work/freezer', hasAvatars: true })
    expect(await findProject(['/work/gero/src', '/work/gero', '/work'], exists)).toEqual({ root: '/work/gero', hasAvatars: false })
    expect(await findProject(['/work/notas', '/work'], exists)).toEqual({ root: '/work', hasAvatars: true })
    expect(await findProject(['/otra'], exists)).toBeNull()
  })

  test('el nombre de un proyecto es el de su carpeta', () => {
    expect(projectName('/work/repo-a')).toBe('repo-a')
  })
})
