export type Level = 'small' | 'everyday' | 'strong' | 'strongest'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// The model lines, smallest first.
export type Line = 'haiku' | 'sonnet' | 'opus' | 'fable'

// What the person sees: 1 = haiku, 2 = sonnet, 3 = opus, 4 = fable.
export type GearNumber = 1 | 2 | 3 | 4

export type PickSource = 'classifier' | 'keywords' | 'tag'

export type PickFlag = 'capped' | 'held' | 'dropped' | 'tagged'

export type LastPick = {
  level: Level
  effort: Effort
  model: string
  isGuess: boolean
  gear: GearNumber
  source: PickSource
  flags: PickFlag[]
}

// What one model loop (the main one, or a subagent's) last sent: the model and the effort
// that went down with the request, and the file or folder its latest tool call named.
export type LoopInfo = {
  model: string
  effort: Effort | null
  target: string | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    // `loops` is keyed by 'main' or the subagent's id.
    vites: { enabled: boolean; last: LastPick | null; loops: Record<string, LoopInfo> }
  }
}
