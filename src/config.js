/**
 * Config resolution. Priority: cordis config > session-bridge.local.json > env.
 *
 * The file lives next to the package so the plugin works when installed as a
 * `link:` dependency from this checkout; nothing is written into the profile.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

export const LOCAL_CONFIG_PATH = join(PLUGIN_DIR, 'session-bridge.local.json')

export function readLocalConfig(path = LOCAL_CONFIG_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function resolveConfig(config = {}, local = readLocalConfig()) {
  const pick = (key, envName) => {
    const fromConfig = config[key]
    if (fromConfig !== undefined && fromConfig !== null && fromConfig !== '') return fromConfig
    const fromLocal = local[key]
    if (fromLocal !== undefined && fromLocal !== null && fromLocal !== '') return fromLocal
    return process.env[envName]
  }

  return {
    token: String(pick('token', 'DSH_SESSION_BRIDGE_TOKEN') ?? '').trim(),
  }
}
