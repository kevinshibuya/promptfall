/** A world boss's sprite key from its name: 'The Promptwyrm' → 'the_promptwyrm'. Shared with scripts/sprites.ts. */
export function worldBossKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
