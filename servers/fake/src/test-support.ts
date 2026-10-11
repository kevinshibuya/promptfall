import type { Bootstrap, ServerClient } from '@promptfall/protocol'

export { nodeFetch } from './node-fetch'

/** A bootstrap the test expects answered: a refusal fails it. */
export async function booted(
  client: Pick<ServerClient, 'bootstrap'>,
  input: { clientVersion: string; deviceToken: string | null },
): Promise<Bootstrap> {
  const boot = await client.bootstrap(input)
  if ('refusal' in boot) throw new Error(`bootstrap refused: ${boot.refusal}`)
  return boot
}
