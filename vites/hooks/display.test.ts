import { describe, expect, test } from 'claude-code/testing'

import type { LoopInfo } from '../types'
import { buildRows, modelName, pruneLoops, sameLoop, sameLoops, shortTarget, targetOf } from './display'

const loop = (model: string, effort: LoopInfo['effort'] = 'high', target: string | null = null): LoopInfo => ({
  model,
  effort,
  target,
  at: 1,
})

describe('model names', () => {
  test('a full id becomes line and version', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelName('claude-fable-5')).toBe('Fable 5')
  })

  test('a bare alias is the line alone, an unknown form comes back as it came', () => {
    expect(modelName('opus')).toBe('Opus')
    expect(modelName('opus[1m]')).toBe('Opus')
    expect(modelName('Haiku')).toBe('Haiku')
    expect(modelName('Default (recommended)')).toBe('Default (recommended)')
    expect(modelName('gpt-5')).toBe('gpt-5')
    expect(modelName('')).toBe('')
  })
})

describe('targets', () => {
  test('inside the session directory a path is relative, with forward slashes', () => {
    expect(shortTarget('/proj/src/app.ts', '/proj')).toBe('src/app.ts')
    expect(shortTarget('/proj/src/app.ts', '/proj/')).toBe('src/app.ts')
    expect(shortTarget('C:\\Users\\me\\proj\\src\\app.ts', 'C:\\Users\\me\\proj')).toBe('src/app.ts')
    expect(shortTarget('c:/users/me/proj/src', 'C:\\Users\\me\\proj')).toBe('src')
    expect(shortTarget('/proj', '/proj')).toBe('.')
  })

  test('outside the directory it is shown as given', () => {
    expect(shortTarget('/etc/hosts', '/proj')).toBe('/etc/hosts')
    expect(shortTarget('/projects/app.ts', '/proj')).toBe('/projects/app.ts')
    expect(shortTarget('**/*.ts', '/proj')).toBe('**/*.ts')
    expect(shortTarget('D:\\other\\x.ts', 'C:\\proj')).toBe('D:/other/x.ts')
  })

  test('with no directory known the last two segments stay', () => {
    expect(shortTarget('/a/b/c/d.ts', undefined)).toBe('c/d.ts')
    expect(shortTarget('C:\\a\\b\\c.ts', '')).toBe('b/c.ts')
    expect(shortTarget('d.ts', undefined)).toBe('d.ts')
  })

  test('a long path is cut from the left to 40 characters', () => {
    const long = 'packages/some-long-package-name/src/components/deeply/nested/file.tsx'
    const cut = shortTarget(long, '/proj')

    expect(cut).toHaveLength(40)
    expect(cut.startsWith('…')).toBe(true)
    expect(cut.endsWith('nested/file.tsx')).toBe(true)
    expect(shortTarget('x'.repeat(40), '/proj')).toBe('x'.repeat(40))
  })

  test('the target of a call comes from the file, else the path, else a search pattern', () => {
    expect(targetOf('Read', { file_path: '/a/b.ts', offset: 3 })).toBe('/a/b.ts')
    expect(targetOf('Edit', { file_path: '/a/b.ts' })).toBe('/a/b.ts')
    expect(targetOf('Write', { file_path: '/a/c.ts' })).toBe('/a/c.ts')
    expect(targetOf('NotebookEdit', { notebook_path: '/a/n.ipynb' })).toBe('/a/n.ipynb')
    expect(targetOf('Glob', { pattern: '**/*.ts', path: '/a' })).toBe('/a')
    expect(targetOf('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
    expect(targetOf('Grep', { pattern: 'TODO' })).toBe('TODO')
    expect(targetOf('Read', {})).toBeNull()
    expect(targetOf('Read', { file_path: 4 })).toBeNull()
  })

  test('Bash has no target and an unknown tool is left alone', () => {
    expect(targetOf('Bash', { command: 'ls' })).toBeNull()
    expect(targetOf('WebFetch', { url: 'https://example.com' })).toBeUndefined()
    expect(targetOf('mcp__x__y', { file_path: '/a' })).toBeUndefined()
  })
})

describe('the loop records', () => {
  test('two records are the same when everything but the time agrees', () => {
    expect(sameLoop({ ...loop('a'), at: 1 }, { ...loop('a'), at: 2 })).toBe(true)
    expect(sameLoop(loop('a'), loop('b'))).toBe(false)
    expect(sameLoop(loop('a', 'low'), loop('a', null))).toBe(false)
    expect(sameLoop(loop('a', 'low', 'x'), loop('a', 'low'))).toBe(false)
    expect(sameLoops({ main: loop('a') }, { main: loop('a') })).toBe(true)
    expect(sameLoops({ main: loop('a') }, { main: loop('a'), a1: loop('b') })).toBe(false)
  })

  test('pruning keeps main, the one just written and the agents still at work', () => {
    const all = { main: loop('a'), a1: loop('b'), a2: loop('c'), a3: loop('d'), a4: loop('e') }
    const agents = [
      { id: 'a1', status: 'running' as const },
      { id: 'a2', status: 'completed' as const },
      { id: 'a3', status: 'killed' as const },
    ]

    expect(Object.keys(pruneLoops(all, agents, 'a4')).sort()).toEqual(['a1', 'a4', 'main'])
  })
})

describe('the rows', () => {
  const agent = (id: string, status: 'running' | 'completed' | 'waiting' | 'pending' | 'idle', more: { name?: string; description?: string; type?: string } = {}) => ({
    id,
    status,
    description: more.description ?? '',
    type: more.type ?? 'general-purpose',
    ...(more.name === undefined ? {} : { name: more.name }),
  })

  test('nothing is drawn before a main record exists', () => {
    expect(buildRows({ loops: { a1: loop('opus') }, agents: [agent('a1', 'running')], gear: 3, cwd: '/proj' })).toEqual([])
  })

  test('the main row carries the gear only when given, and the target only when there is one', () => {
    const [on] = buildRows({ loops: { main: loop('claude-opus-5-5', 'high', '/proj/a.ts') }, agents: [], gear: 3, cwd: '/proj' })
    const [off] = buildRows({ loops: { main: loop('claude-opus-5-5', null) }, agents: [], gear: null, cwd: '/proj' })

    expect(on).toEqual({ kind: 'main', label: 'Ana', model: 'Opus 5.5', effort: 'yüksek', gear: '3. vites', target: 'a.ts' })
    expect(off).toEqual({ kind: 'main', label: 'Ana', model: 'Opus 5.5', effort: 'varsayılan', gear: null, target: null })
  })

  test('only subagents at work with a record get a row, named by name, description or type, labels padded', () => {
    const rows = buildRows({
      loops: {
        main: loop('opus'),
        a1: loop('haiku', 'low', '/proj/x.ts'),
        a2: loop('sonnet'),
        a3: loop('sonnet'),
        a4: loop('sonnet'),
        a5: loop('sonnet'),
        a6: loop('sonnet'),
      },
      agents: [
        agent('a1', 'running', { name: 'tarayıcı', description: 'Tarama' }),
        agent('a2', 'completed'),
        agent('a3', 'waiting', { description: 'Rapor yaz' }),
        agent('a4', 'pending', { type: 'Explore' }),
        agent('a5', 'idle'),
        agent('nobody', 'running'),
      ],
      gear: 2,
      cwd: '/proj',
    })

    expect(rows.map(row => row.label)).toEqual(['Ana      ', 'tarayıcı ', 'Rapor yaz', 'Explore  '])
    expect(rows[1]).toMatchObject({ kind: 'sub', model: 'Haiku', effort: 'düşük', gear: null, target: 'x.ts' })
  })

  test('a very long name is cut', () => {
    const rows = buildRows({
      loops: { main: loop('opus'), a1: loop('haiku') },
      agents: [agent('a1', 'running', { description: 'x'.repeat(60) })],
      gear: null,
      cwd: undefined,
    })

    expect(rows[1]?.label.trimEnd()).toHaveLength(24)
    expect(rows[1]?.label.trimEnd().endsWith('…')).toBe(true)
  })
})
