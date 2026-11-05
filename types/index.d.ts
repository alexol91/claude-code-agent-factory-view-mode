/** What an agent at a desk is doing right now. */
export type AgentStatus = 'working' | 'waiting' | 'sleeping' | 'done' | 'failed'

/** Qué tipo de trabajo es una llamada a herramienta: su icono y con quién se agrupa. */
export type CallFamily = 'bash' | 'edit' | 'read' | 'search' | 'web' | 'agent' | 'mcp' | 'other'

export type CallStatus = 'running' | 'done' | 'failed'

/** Una llamada a herramienta de un agente, para el detalle de actividad. */
export type Call = {
  /** El `tool_use_id` de la llamada. */
  id: string
  tool: string
  family: CallFamily
  /** Fichero, comando, patrón… lo mismo que alimenta el bocadillo. */
  label: string
  status: CallStatus
  start: number
  end?: number
}

/** One agent on the factory floor: the main loop (`id: 'main'`) or a subagent. */
/** El proyecto (repo) donde trabaja un agente, según lo último que tocó. */
export type AgentProject = {
  root: string
  /** El `nombre` de avatar.json, o el nombre de la carpeta. */
  name: string
  /** Si el repo tiene carpeta `.claude/avatars`. */
  hasAvatars: boolean
}

export type FactoryAgent = {
  id: string
  isMain: boolean
  /** The subagent type (`Explore`, `general-purpose`, ...), `main` for the main loop. */
  type: string
  /** The short name drawn under the desk. */
  label: string
  /** The task the agent was given, as the Agent call described it. */
  description: string
  project: AgentProject | null
  status: AgentStatus
  /** How its last task ended, kept after it dozes off: a badge over its head. */
  outcome: 'ok' | 'failed' | null
  /** The tool the agent runs, or ran last while it keeps working; null before its first. */
  tool: string | null
  /** A few words on what the tool works on (a file, a command, a query). */
  detail: string | null
  /** The `tool_use_id` of the tool while it runs, so only its own end marks it ended. */
  toolId: string | null
  /** Epoch milliseconds of the last status change. */
  since: number
  /** Cuándo llegó a la oficina, en milisegundos. */
  startedAt: number
  /** The desk: 0 is the manager's, the rest ring around it. */
  seat: number
  toolCount: number
  /** A named member of the session's team: it waits for messages between turns. */
  isTeammate: boolean
  /** One of `/oficina demo`'s pretend agents. */
  isDemo: boolean
}

export type ColorName =
  | 'clay'
  | 'tangerine'
  | 'sun'
  | 'lime'
  | 'mint'
  | 'teal'
  | 'sky'
  | 'ocean'
  | 'grape'
  | 'berry'
  | 'rose'
  | 'snow'
  | 'slate'
  | 'cocoa'

export type HatName =
  | 'none'
  | 'crown'
  | 'tophat'
  | 'cap'
  | 'beanie'
  | 'wizard'
  | 'party'
  | 'hardhat'
  | 'chef'
  | 'cowboy'
  | 'explorer'
  | 'propeller'
  | 'headphones'
  | 'bow'
  | 'halo'
  | 'antenna'
  | 'gradcap'
  | 'viking'
  | 'sprout'

export type AccessoryName =
  | 'none'
  | 'glasses'
  | 'shades'
  | 'monocle'
  | 'tie'
  | 'bowtie'
  | 'mustache'
  | 'scarf'
  | 'blush'

/** How one agent (or every agent of one type) looks. */
export type AgentStyle = { color: ColorName; hat: HatName; accessory: AccessoryName }

/** How agents nobody styled look: each its own by lot, or dressed for their type. */
export type LooksMode = 'random' | 'type'

/** How big the agents are drawn. */
export type AgentSize = 'small' | 'medium' | 'large'

declare module 'claude-code' {
  interface PluginState {
    oficina: {
      /** Sube con `/oficina recargar`, para redibujar con los avatares leídos de nuevo. */
      refresh: number
      agents: FactoryAgent[]
      /** Keyed by `main`, `type:<subagent type>` or `agent:<agent id>`. */
      styles: Record<string, AgentStyle>
      looks: LooksMode
      size: AgentSize
      /** The agent whose style the pane is editing. */
      selected: string | null
      /** Whether the pane's style controls dress the picked agent alone or its whole type. */
      scope: 'agent' | 'type'
      isDemo: boolean
      /** El historial de llamadas de cada agente, por su id. */
      calls: Record<string, Call[]>
      /** La pestaña abierta del agente elegido. */
      tab: 'actividad' | 'vestir'
    }
  }
}
