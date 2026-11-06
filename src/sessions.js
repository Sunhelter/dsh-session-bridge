/**
 * Workspace listing, blank-Session lookup, and the user message shape.
 *
 * The plugin runs inside the Host, so it reads the services the Web sidebar
 * uses instead of an RPC client: `workspaceRegistry` for the records and
 * `sessionPersistence` plus `sessionProjectionCache` for the "still blank"
 * check that lets `create` reuse an existing Session.
 */
import { randomUUID } from 'node:crypto'

/**
 * Every Workspace the sidebar would show, without its Sessions.
 * @param {object} ctx host context
 * @returns {{ ok: true, workspaces: object[] } | { ok: false, error: string }}
 */
export function listWorkspaces(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (!registry) return { ok: false, error: '当前部署没有 workspaceRegistry' }
  const workspaces = registry.list().map((entity) => ({
    id: entity.id,
    title: entity.title?.trim() || entity.path,
    path: entity.path,
  }))
  return { ok: true, workspaces }
}

/**
 * First blank Session already attached to one Workspace. The Web sidebar reuses
 * such a row when you open a new conversation instead of minting another empty
 * Session, and this route follows the same rule.
 * @param {object} ctx host context
 * @param {string} workspaceId workspace to look in
 * @returns {Promise<string | undefined>} reusable session id
 */
export async function blankSessionIn(ctx, workspaceId) {
  const registry = ctx.get('workspaceRegistry')
  const workspace = registry?.get?.(workspaceId)
  const persistence = ctx.get('sessionPersistence')
  const cache = ctx.get('sessionProjectionCache')
  if (!workspace || !persistence || !cache) return undefined

  const archived = new Set(registry.archivedSessionIds ?? [])
  const members = new Set(workspace.sessionIds ?? [])
  let snapshots
  try {
    snapshots = await persistence.list()
  } catch {
    return undefined
  }

  for (const { header } of snapshots) {
    if (archived.has(header.id) || !members.has(header.id)) continue
    let metadata
    try {
      metadata = cache.cachedSnapshot(header, ['sessionListMetadata'])?.values?.sessionListMetadata
    } catch {
      metadata = undefined
    }
    if (metadata?.blank === true) return header.id
  }
  return undefined
}

/** A user turn in the shape the agent loop accepts. */
export function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}
