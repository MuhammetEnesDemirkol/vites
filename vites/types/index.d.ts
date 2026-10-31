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

declare module 'claude-code' {
  interface PluginState {
    vites: { enabled: boolean; last: LastPick | null }
  }
}
