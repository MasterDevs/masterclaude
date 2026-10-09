// The status pane's session state (hooks/register.js). Held by the host, so a hot reload keeps it.

export type MasterdevsActivity = {
  id: string
  seq: number
  text: string
  state: 'started' | 'sampled' | 'done' | 'failed' | 'denied'
  at?: number // when the line first appeared, epoch ms
}

// Which plan step (or fix) a build agent said it is on, by agent id.
export type MasterdevsProgress = { kind: 'step' | 'fix'; step: number; of: number; title: string }

// What the last refresh found; the model's shape is summarize() in hooks/lib/run-status.mjs.
export type MasterdevsView = {
  kind: 'starting' | 'none' | 'unavailable' | 'run'
  reason?: string
  now?: number
  model?: Record<string, unknown>
  stale?: boolean
  problem?: string | null
  // estimate() in hooks/lib/eta.mjs; at/lo/hi are epoch ms, null when there is nothing honest to say.
  eta?: { kind: 'plan' | 'build' | null; n: number; at: number | null; lo?: number; hi?: number; overdue?: boolean; reason?: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    masterdevs: {
      view: MasterdevsView
      tails: Record<string, MasterdevsActivity[]>
      samples: Record<string, MasterdevsActivity[]>
      dismissed: boolean
      autoOpened: string | null
      hint: boolean
      session: string
      transcript: { sessionId: string; path: string } | null
      launches: string[]
      progress: Record<string, MasterdevsProgress>
      autoClosed: string | null
    }
  }
}
