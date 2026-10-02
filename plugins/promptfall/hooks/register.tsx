import type { Register } from 'claude-code'
import { StoreKeyValue } from './storage'
import { CLIENT_VERSION } from './version'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const kv = new StoreKeyValue({
      get: (key) => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: (key) => $.store.delete(key),
    })
    const seen = await kv.get('lastClientVersion')
    if (seen !== CLIENT_VERSION) await kv.set('lastClientVersion', CLIENT_VERSION)
    return next(e)
  })
}
