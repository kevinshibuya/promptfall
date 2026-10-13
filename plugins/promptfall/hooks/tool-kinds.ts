import type { WaveArchetype } from './vendor/sim.js'

/**
 * The wave enemy a tool's call spawns, one row per tool name: reads and searches the swift,
 * edits and writes the brute, the shell the caster. A new tool is a row here.
 *
 * This engine build has no Grep or Glob tool and searches run through Bash, so a search spawns a
 * caster until the engine grows a search tool; the two rows wait for the builds that have them.
 */
const TOOL_KINDS = new Map<string, WaveArchetype>([
  ['Read', 'swift'],
  ['WebFetch', 'swift'],
  ['WebSearch', 'swift'],
  ['LSP', 'swift'],
  ['Grep', 'swift'],
  ['Glob', 'swift'],
  ['Edit', 'brute'],
  ['Write', 'brute'],
  ['NotebookEdit', 'brute'],
  ['MultiEdit', 'brute'],
  ['Bash', 'caster'],
])

/** Every tool the table lacks, every MCP tool, and every call a subagent makes: the tank. */
const DEFAULT_KIND: WaveArchetype = 'tank'

/** The archetype hint of a `tool_call`: a subagent's call is a tank whatever its tool. */
export function toolKind(tool: string, agentId: string | undefined): WaveArchetype {
  if (agentId) return DEFAULT_KIND
  return TOOL_KINDS.get(tool) ?? DEFAULT_KIND
}
