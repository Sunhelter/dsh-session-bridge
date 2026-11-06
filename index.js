/**
 * Host half of the Session Bridge bundle.
 *
 * Two token-guarded HTTP routes let a machine outside the Host (a Windows
 * agent with curl, for example) run the same flow as Telegram's `/new`: list
 * Workspaces, create a Session in one, and post the first prompt. The Session
 * is an ordinary Workspace member created through `sessionController.create`,
 * so it shows up in the Web sidebar like any conversation started there.
 *
 * The routes deliberately skip Connection's browser check: curl has no cookie.
 * The shared bearer token is therefore the only admission rule, and an empty
 * token keeps both routes closed instead of opening them to everyone.
 */
import { resolveConfig } from './src/config.js'
import { readJsonBody, sendJson } from './src/http.js'
import { blankSessionIn, listWorkspaces, userMessage } from './src/sessions.js'

export const name = 'session-bridge'

export const inject = ['webServer', 'agents']

/** Same-origin list endpoint owned by this plugin. */
const WORKSPACES_PATH = '/plugins/session-bridge/workspaces'

/** Same-origin create endpoint owned by this plugin. */
const SESSIONS_PATH = '/plugins/session-bridge/sessions'

/** Largest prompt this route forwards; the model context is the real limit. */
const MAX_PROMPT_CHARS = 200_000

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Default provider/model so a Session created without a per-Session pick can run. */
function defaultAgentOptions(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (!selection?.provider || !selection?.model) return undefined
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    }
  } catch {
    return undefined
  }
}

export function apply(ctx, config) {
  const resolved = resolveConfig(config ?? {})
  if (!resolved.token) {
    ctx.logger.warn('session-bridge: no token configured; both routes stay closed')
  }

  const admitted = (req, res) => {
    if (!resolved.token) {
      sendJson(res, 503, { ok: false, error: '没有配置 token，接口未启用' })
      return false
    }
    const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())
    if (!match || match[1].trim() !== resolved.token) {
      res.setHeader('www-authenticate', 'Bearer')
      sendJson(res, 401, { ok: false, error: 'token 不对' })
      return false
    }
    return true
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: WORKSPACES_PATH,
        handler: (req, res) => {
          if (!admitted(req, res)) return
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          const listed = listWorkspaces(ctx)
          if (!listed.ok) {
            sendJson(res, 503, { ok: false, error: listed.error })
            return
          }
          sendJson(res, 200, { ok: true, workspaces: listed.workspaces })
        },
      }),
    'session-bridge: workspaces route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SESSIONS_PATH,
        handler: async (req, res) => {
          if (!admitted(req, res)) return
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }

          let body
          try {
            body = await readJsonBody(req)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: errorText(error) })
            return
          }

          const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
          const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
          const message = typeof body.message === 'string' ? body.message : ''
          if (workspaceId !== '' && cwd !== '') {
            sendJson(res, 400, { ok: false, error: 'workspaceId 和 cwd 只能给一个' })
            return
          }
          if (workspaceId === '' && cwd === '') {
            sendJson(res, 400, { ok: false, error: '要带 workspaceId（或 cwd）' })
            return
          }
          if (message.trim() === '') {
            sendJson(res, 400, { ok: false, error: 'message 不能为空' })
            return
          }
          if (message.length > MAX_PROMPT_CHARS) {
            sendJson(res, 400, { ok: false, error: `message 超过 ${MAX_PROMPT_CHARS} 字` })
            return
          }

          const controller = ctx.get('sessionController')
          if (typeof controller?.create !== 'function') {
            sendJson(res, 503, { ok: false, error: '当前部署没有 sessionController.create' })
            return
          }
          const agents = ctx.get('agents')
          if (!agents) {
            sendJson(res, 503, { ok: false, error: '当前部署没有 agents 服务' })
            return
          }

          // Same rule as `/new` and the Web "+": reuse the Workspace's blank
          // Session while it is still blank instead of minting another row.
          const blank = workspaceId === '' ? undefined : await blankSessionIn(ctx, workspaceId)

          let created
          try {
            created = await controller.create({
              ...(workspaceId === '' ? { cwd } : { workspaceId }),
              ...(blank === undefined ? {} : { sessionId: blank }),
            })
          } catch (error) {
            const status = /not found|不存在/i.test(errorText(error)) ? 404 : 500
            sendJson(res, status, { ok: false, error: errorText(error) })
            return
          }

          const sessionId = created?.sessionId
          if (typeof sessionId !== 'string' || sessionId === '') {
            sendJson(res, 500, { ok: false, error: '宿主没有返回会话 id' })
            return
          }

          let agent = agents.get(sessionId)
          if (!agent) {
            try {
              const handle = await agents.resume({
                resumeSessionId: sessionId,
                agentOptions: defaultAgentOptions(ctx),
              })
              agent = handle.agent
            } catch (error) {
              sendJson(res, 500, { ok: false, error: `会话已建好，但恢复失败：${errorText(error)}`, sessionId })
              return
            }
          }

          try {
            if (agent.status === 'running') agent.steer(userMessage(message))
            else agent.followup(userMessage(message))
          } catch (error) {
            sendJson(res, 500, { ok: false, error: `会话已建好，但发消息失败：${errorText(error)}`, sessionId })
            return
          }

          ctx.logger.info(`session-bridge: ${blank === sessionId ? 'reused blank' : 'created'} ${sessionId}`)
          sendJson(res, 200, { ok: true, sessionId, reused: blank === sessionId })
        },
      }),
    'session-bridge: sessions route',
  )
}
