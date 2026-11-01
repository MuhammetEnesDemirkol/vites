import type { AgentInfo } from 'claude-code'

import type { Effort, GearNumber, LoopInfo } from '../types'
import { effortTr } from './logic'

export const MAIN = 'main'

const MAX_TARGET = 40
const MAX_NAME = 24
const MAX_STORED = 300

const LINES = 'haiku|sonnet|opus|fable'
// claude-opus-5-5, claude-opus-4-20250514
const NEW_ID = new RegExp(`^claude-(${LINES})-(\\d+)(?:-(\\d{1,2}))?(?:-\\d{8})?$`)
// claude-3-5-sonnet-20241022
const OLD_ID = new RegExp(`^claude-(\\d+)(?:-(\\d{1,2}))?-(${LINES})(?:-\\d{8})?$`)
const ALIAS = new RegExp(`^(${LINES})$`)

const FILE_TOOLS: readonly string[] = ['Read', 'Edit', 'Write', 'NotebookEdit']
const SEARCH_TOOLS: readonly string[] = ['Glob', 'Grep']

// A subagent that is still at work; the others are not drawn.
const LIVE: readonly AgentInfo['status'][] = ['pending', 'running', 'waiting']

function capital(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1)
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`, an alias `opus` → `Opus`; an unknown form comes back as it came. */
export function modelName(id: string): string {
  const bare = id.trim().toLowerCase().replace(/\[[^\]]*\]$/, '')

  const alias = ALIAS.exec(bare)
  if (alias !== null) return capital(alias[1] ?? '')

  const fresh = NEW_ID.exec(bare)
  if (fresh !== null) return `${capital(fresh[1] ?? '')} ${fresh[2]}${fresh[3] === undefined ? '' : `.${fresh[3]}`}`

  const old = OLD_ID.exec(bare)
  if (old !== null) return `${capital(old[3] ?? '')} ${old[1]}${old[2] === undefined ? '' : `.${old[2]}`}`

  return id
}

function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Cuts from the left, so the end of a path (the part that tells files apart) stays. */
function trimLeft(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - (max - 1))}`
}

/**
 * A path as the block shows it: relative to the session's directory when it lies inside,
 * else as given; with no directory known, the last two segments. Forward slashes, cut
 * from the left with `…` to about 40 characters.
 */
export function shortTarget(path: string, cwd: string | undefined, max: number = MAX_TARGET): string {
  const full = slashed(path)
  const root = cwd === undefined ? '' : slashed(cwd).replace(/\/+$/, '')

  if (root === '') {
    const segments = full.split('/').filter(segment => segment !== '')

    return trimLeft(segments.length > 2 ? segments.slice(-2).join('/') : full, max)
  }

  // A drive letter's case is not a difference; elsewhere it is.
  const isDrive = /^[a-z]:/i.test(root)
  const left = isDrive ? full.toLowerCase() : full
  const base = isDrive ? root.toLowerCase() : root
  if (left === base) return '.'

  return trimLeft(left.startsWith(`${base}/`) ? full.slice(root.length + 1) : full, max)
}

function stored(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_STORED) : undefined
}

/**
 * What a tool call works on: `file_path` (`notebook_path` for a notebook), else `path`, else a
 * search's `pattern`. Bash works on no file, so it is null. Undefined for a tool this does not know.
 */
export function targetOf(tool: string, args: Readonly<Record<string, unknown>>): string | null | undefined {
  if (tool === 'Bash') return null
  if (FILE_TOOLS.includes(tool)) return stored(args.file_path) ?? stored(args.notebook_path) ?? null
  if (SEARCH_TOOLS.includes(tool)) return stored(args.path) ?? stored(args.pattern) ?? null

  return undefined
}

export function sameLoop(a: LoopInfo, b: LoopInfo): boolean {
  return a.model === b.model && a.effort === b.effort && a.target === b.target
}

export function withLoop(loops: Readonly<Record<string, LoopInfo>>, key: string, info: LoopInfo): Record<string, LoopInfo> {
  return { ...loops, [key]: info }
}

/** Keeps main, `keep`, and the agents still at work; the records of the others go. */
export function pruneLoops(
  loops: Readonly<Record<string, LoopInfo>>,
  agents: readonly Pick<AgentInfo, 'id' | 'status'>[],
  keep: string,
): Record<string, LoopInfo> {
  const live = new Set(agents.filter(agent => LIVE.includes(agent.status)).map(agent => agent.id))
  const kept: Record<string, LoopInfo> = {}
  for (const [key, info] of Object.entries(loops)) {
    if (key === MAIN || key === keep || live.has(key)) kept[key] = info
  }

  return kept
}

/** True when both hold the same keys with the same content (`at` aside), so the atom need not be written. */
export function sameLoops(a: Readonly<Record<string, LoopInfo>>, b: Readonly<Record<string, LoopInfo>>): boolean {
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length && keys.every(key => {
    const left = a[key]
    const right = b[key]

    return left !== undefined && right !== undefined && sameLoop(left, right)
  })
}

export type Row = {
  kind: 'main' | 'sub'
  /** The name, padded so the columns of every row line up. */
  label: string
  model: string
  effort: string
  /** `3. vites`, only on the main row and only while Vites is on and has picked. */
  gear: string | null
  /** Already shortened. */
  target: string | null
}

export type AgentLite = Pick<AgentInfo, 'id' | 'description' | 'type' | 'status' | 'name'>

type RowsInput = {
  loops: Readonly<Record<string, LoopInfo>>
  agents: readonly AgentLite[]
  gear: GearNumber | null
  cwd: string | undefined
}

function effortWords(effort: Effort | null): string {
  return effort === null ? 'varsayılan' : effortTr(effort)
}

function shown(target: string | null, cwd: string | undefined): string | null {
  return target === null ? null : shortTarget(target, cwd)
}

function clip(name: string): string {
  return name.length <= MAX_NAME ? name : `${name.slice(0, MAX_NAME - 1)}…`
}

/** The main row when there is a main record, then one row per subagent at work that has a record. */
export function buildRows({ loops, agents, gear, cwd }: RowsInput): Row[] {
  const main = loops[MAIN]
  if (main === undefined) return []

  const rows: Row[] = [
    {
      kind: 'main',
      label: 'Ana',
      model: modelName(main.model),
      effort: effortWords(main.effort),
      gear: gear === null ? null : `${gear}. vites`,
      target: shown(main.target, cwd),
    },
  ]

  for (const agent of agents) {
    const info = loops[agent.id]
    if (info === undefined || !LIVE.includes(agent.status)) continue
    const name = [agent.name, agent.description, agent.type].find(word => word !== undefined && word !== '') ?? agent.id
    rows.push({
      kind: 'sub',
      label: clip(name),
      model: modelName(info.model),
      effort: effortWords(info.effort),
      gear: null,
      target: shown(info.target, cwd),
    })
  }

  const width = Math.max(...rows.map(row => row.label.length))

  return rows.map(row => ({ ...row, label: row.label.padEnd(width) }))
}
