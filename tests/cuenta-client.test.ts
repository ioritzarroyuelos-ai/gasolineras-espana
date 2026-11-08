// @ts-expect-error El cliente se ejecuta aislado en Node, sin añadir sus tipos a la app Worker.
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, it, expect, vi } from 'vitest'
import source from '../src/client/cuenta.js?raw'

const fav = 'gs_favs_v1', owner = 'eu-cuenta-owner-v1'
const a = { sub: 'A', name: 'Ana', email: 'ana@example.test' }, b = { sub: 'B', name: 'Bea' }
const station = (id: string) => ({ id, rotulo: 'Gasolinera ' + id })
function deferred() { let resolve!: (value: any) => void; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers() })

function sharedLocks() {
  const queues = new Map<string, Promise<unknown>>()
  return { request(name: string, callback: () => unknown) { const task = (queues.get(name) || Promise.resolve()).catch(() => {}).then(callback); queues.set(name, task); return task } }
}
function client(initial: Record<string, string> = {}, account: any = a, cloud: Record<string, any> = {}, shared?: { storage: Map<string, string>; locks?: ReturnType<typeof sharedLocks> }) {
  const storage = shared?.storage || new Map(Object.entries(initial)), listeners = new Map<string, Function[]>(), nodes = new Map<string, any>()
  const on = (name: string, listener: Function) => listeners.set(name, [...(listeners.get(name) || []), listener])
  const emit = (name: string, event: any = {}) => { for (const callback of listeners.get(name) || []) callback(event) }
  function node(id: string) {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: '', classList: { toggle() {} }, setAttribute() {}, focus() {}, contains: () => false,
      addEventListener(name: string, fn: Function) { on(id + ':' + name, fn) }, querySelectorAll: () => [] })
    return nodes.get(id)
  }
  let current = account, syncFailure = 0, logoutFailure = false, putGate: any = null, getGate: any = null, meGate: any = null
  let putFailure: number | 'network' = 0
  const remote: Record<string, any> = { A: cloud, B: {} }
  const fetch = vi.fn(async (url: string, options: any = {}) => {
    if (url === '/api/me') return meGate ? meGate.promise : { ok: true, json: async () => ({ user: current }) }
    if (url === '/api/auth/logout') { if (logoutFailure) return { ok: false, status: 500 }; current = null; return { ok: true, json: async () => ({ ok: true }) } }
    if (url === '/api/sync') {
      if (getGate) return getGate.promise
      if (syncFailure) return { ok: false, status: syncFailure }
      return { ok: true, json: async () => ({ data: structuredClone(remote[current.sub]) }) }
    }
    if (url.startsWith('/api/sync/')) {
      if (options.headers['X-Account-Id'] !== current?.sub) return { ok: false, status: 409 }
      if (putFailure === 'network') throw new TypeError('Failed to fetch')
      if (putFailure) return { ok: false, status: putFailure }
      const atStart = current.sub
      if (putGate) await putGate.promise
      remote[atStart][decodeURIComponent(url.split('/').at(-1)!)] = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ok: true }) }
    }
    throw new Error('Unexpected request ' + url)
  })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const trackedTimeout = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, delay)
    timers.add(timer); return timer
  }
  const trackedClear = (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer) }
  cleanups.push(() => { for (const timer of timers) clearTimeout(timer); timers.clear() })
  const window: any = { addEventListener: on, dispatchEvent: (event: any) => emit(event.type, event) }
  const context = createContext({ window, document: { getElementById: node, addEventListener() {} }, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  }, fetch, crypto, navigator: { locks: shared?.locks }, AbortController, setTimeout: trackedTimeout, clearTimeout: trackedClear, CustomEvent: class { constructor(public type: string, public detail: any) { this.detail = detail.detail } } })
  runInContext(source, context)
  const writes = () => fetch.mock.calls.filter(([url, opts]) => url.startsWith('/api/sync/') && opts.method === 'PUT')
  return { storage, window, fetch, remote, node, emit, writes, setUser: (value: any) => { current = value }, failSync: (code: number) => { syncFailure = code },
    failPut: (failure: number | 'network') => { putFailure = failure }, failLogout: () => { logoutFailure = true }, gatePut: (gate: any) => { putGate = gate }, gateGet: (gate: any) => { getGate = gate }, gateMe: (gate: any) => { meGate = gate } }
}

describe('shared account favorites', () => {
  it('uses cloud deletions and does not upload old browser favorites on login', async () => {
    const c = client({ [fav]: JSON.stringify([station('old')]) }, a, { [fav]: [] })
    await c.window.EUCuenta.ready
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([])
    expect(c.writes()).toHaveLength(0)
    expect(JSON.parse(c.storage.get('eu-cuenta-invitado-v1')!)[fav]).toEqual([station('old')])
  })
  it('gets a complete account snapshot without uploading it again', async () => {
    const c = client({}, a, { [fav]: [station('saved')], 'espana-util-municipio': '28079' })
    await c.window.EUCuenta.ready
    expect(c.storage.get('espana-util-municipio')).toBe('28079')
    expect(c.storage.get(owner)).toBe('A')
    expect(c.writes()).toHaveLength(0)
    expect(c.node('user-name').textContent).toBe('Ana')
  })
  it('never uploads an unconfirmed snapshot after a failed GET', async () => {
    const c = client({ [fav]: JSON.stringify([station('guest')]) })
    c.failSync(503)
    await c.window.EUCuenta.ready
    expect(c.window.EUCuenta.status).toBe('error')
    expect(c.writes()).toHaveLength(0)
  })
  it('propagates removing the last favorite as an empty list', async () => {
    const c = client({}, a, { [fav]: [station('one')] })
    await c.window.EUCuenta.ready
    c.storage.set(fav, '[]')
    await c.window.EUCuenta.changed(fav)
    expect(c.remote.A[fav]).toEqual([])
    expect(c.writes()[0][1].headers['X-Account-Id']).toBe('A')
    expect(c.window.EUCuenta.status).toBe('saved')
  })
  it('keeps the latest intent when an add is followed by removal during an upload', async () => {
    const c = client({}, a, { [fav]: [] }); await c.window.EUCuenta.ready
    const gate = deferred(); c.gatePut(gate)
    c.storage.set(fav, JSON.stringify([station('one')]))
    const first = c.window.EUCuenta.changed(fav)
    c.storage.set(fav, '[]'); c.window.EUCuenta.changed(fav)
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].value).toEqual([])
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].ops.remove).toEqual(['one'])
    gate.resolve(null); await first
    expect(c.remote.A[fav]).toEqual([])
    expect(c.writes()).toHaveLength(2)
  })
  it('applies only explicit offline list changes to the next server snapshot', async () => {
    const c = client({ [owner]: 'A', [fav]: JSON.stringify([station('old'), station('added')]),
      'eu-cuenta-pendientes-v1:A': JSON.stringify({ [fav]: { base: [station('old')], value: [station('old'), station('added')] } }),
    }, a, { [fav]: [station('other-device')] })
    await c.window.EUCuenta.ready
    expect(c.remote.A[fav]).toEqual([station('other-device'), station('added')])
  })
  it('restores only guest favorites on logout and isolates another account', async () => {
    const c = client({ [fav]: JSON.stringify([station('guest')]) }, a, { [fav]: [station('ana')] })
    await c.window.EUCuenta.ready
    c.emit('btn-logout:click'); await settle()
    expect(c.window.EUCuenta.user).toBeNull()
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([station('guest')])
    c.setUser(b); c.remote.B = { [fav]: [station('bea')] }
    await c.window.EUCuenta.refresh()
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([station('bea')])
    expect(c.writes()).toHaveLength(0)
  })
  it('keeps the visible session when logout fails', async () => {
    const c = client({}, a, { [fav]: [station('one')] }); await c.window.EUCuenta.ready
    c.failLogout(); c.emit('btn-logout:click'); await settle()
    expect(c.window.EUCuenta.user.sub).toBe('A')
    expect(c.window.EUCuenta.status).toBe('logoutError')
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([station('one')])
  })
  it('discards a late pull after logging out', async () => {
    const c = client({}, a, { [fav]: [station('one')] }); await c.window.EUCuenta.ready
    const gate = deferred(); c.gateGet(gate)
    const old = c.window.EUCuenta.refresh(); await settle()
    c.emit('btn-logout:click'); await settle()
    gate.resolve({ ok: true, json: async () => ({ data: { [fav]: [station('private')] } }) }); await old
    expect(c.window.EUCuenta.user).toBeNull()
    expect(c.storage.get(fav)).toBeUndefined()
  })
  it('does not upload favorites owned by a different browser tab account', async () => {
    const c = client({}, a, { [fav]: [station('ana')] }); await c.window.EUCuenta.ready
    c.storage.set(owner, 'B'); c.storage.set(fav, JSON.stringify([station('bea')]))
    c.setUser(b); c.remote.B = { [fav]: [station('bea')] }
    await c.window.EUCuenta.changed(fav)
    expect(c.window.EUCuenta.user.sub).toBe('B')
    expect(c.writes()).toHaveLength(0)
    expect(c.remote.A[fav]).toEqual([station('ana')])
  })

  it('another tab cannot replace a pending favorite with the older cloud snapshot', async () => {
    const shared = { storage: new Map<string, string>(), locks: sharedLocks() }, cloud = { [fav]: [] }
    const first = client({}, a, cloud, shared); await first.window.EUCuenta.ready
    const second = client({}, a, cloud, shared); await second.window.EUCuenta.ready
    const put = deferred(); first.gatePut(put)
    shared.storage.set(fav, JSON.stringify([station('new')]))
    const saving = first.window.EUCuenta.changed(fav); await settle()
    second.emit('storage', { key: 'eu-cuenta-pendientes-v1:A' }); await settle()
    const reading = second.window.EUCuenta.refresh()
    expect(JSON.parse(shared.storage.get(fav)!)).toEqual([station('new')])
    expect(JSON.parse(shared.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].value).toEqual([station('new')])
    put.resolve(null); await saving; await reading
    expect(cloud[fav]).toEqual([station('new')])
    expect(JSON.parse(shared.storage.get(fav)!)).toEqual([station('new')])
    expect(second.writes()).toHaveLength(0)
  })

  it('an older acknowledgement cannot erase another tab’s newer removal', async () => {
    const shared = { storage: new Map<string, string>(), locks: sharedLocks() }, cloud = { [fav]: [] }
    const first = client({}, a, cloud, shared); await first.window.EUCuenta.ready
    const second = client({}, a, cloud, shared); await second.window.EUCuenta.ready
    const put = deferred(); first.gatePut(put)
    shared.storage.set(fav, JSON.stringify([station('one')]))
    const adding = first.window.EUCuenta.changed(fav); await settle()
    const oldRevision = JSON.parse(shared.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].revision
    shared.storage.set(fav, '[]')
    const removing = second.window.EUCuenta.changed(fav); await settle()
    expect(JSON.parse(shared.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].revision).not.toBe(oldRevision)
    expect(second.writes()).toHaveLength(0)
    put.resolve(null); await adding; await removing
    expect(cloud[fav]).toEqual([])
    expect(JSON.parse(shared.storage.get(fav)!)).toEqual([])
    expect(JSON.parse(shared.storage.get('eu-cuenta-pendientes-v1:A')!)).toEqual({})
  })

  it('invalidates an old pull immediately when another tab changes the storage owner', async () => {
    const c = client({}, a, { [fav]: [station('private-A')] }); await c.window.EUCuenta.ready
    const get = deferred(); c.gateGet(get)
    const old = c.window.EUCuenta.refresh(); await settle()
    c.storage.set(owner, 'B'); c.storage.set(fav, JSON.stringify([station('private-B')]))
    c.remote.B = { [fav]: [station('private-B')] }; c.setUser(b); c.gateGet(null)
    c.emit('storage', { key: owner }); await c.window.EUCuenta.refresh()
    get.resolve({ ok: true, json: async () => ({ data: { [fav]: [station('private-A')] } }) }); await old
    expect(c.storage.get(owner)).toBe('B')
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([station('private-B')])
    expect(c.window.EUCuenta.user.sub).toBe('B')
    expect(c.writes()).toHaveLength(0)
  })

  it('does not restore an older /me response after logout and a new login', async () => {
    const c = client({}, a, { [fav]: [station('private-A')] }); await c.window.EUCuenta.ready
    const me = deferred(); c.gateMe(me)
    const old = c.window.EUCuenta.refresh(); await settle()
    c.emit('btn-logout:click'); await settle()
    c.setUser(b); c.remote.B = { [fav]: [station('private-B')] }; c.gateMe(null)
    await c.window.EUCuenta.refresh()
    me.resolve({ ok: true, json: async () => ({ user: a }) }); await old
    expect(c.window.EUCuenta.user.sub).toBe('B')
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([station('private-B')])
  })

  it.each(['{damaged', '"x"', '[]', '{"obsolete-key":{"base":null,"value":[]}}', '{"gs_favs_v1":{"base":[],"value":[null]}}'])('ignores unusable local queues without looping: %s', async damaged => {
    const c = client({ 'eu-cuenta-pendientes-v1:A': damaged, 'eu-cuenta-base-v1:A': '"invalid"', 'eu-cuenta-cache-v1:A': '[]' }, a, { [fav]: [station('remote')] })
    await c.window.EUCuenta.ready
    expect(c.window.EUCuenta.status).toBe('saved')
    expect(c.writes()).toHaveLength(0)
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([station('remote')])
  })

  it('keeps a re-added favorite across reload when its prior removal has reached the server', async () => {
    const c = client({}, a, { [fav]: [station('one')] }); await c.window.EUCuenta.ready
    const put = deferred(); c.gatePut(put)
    c.storage.set(fav, '[]'); const removing = c.window.EUCuenta.changed(fav)
    c.storage.set(fav, JSON.stringify([station('one')])); c.window.EUCuenta.changed(fav)
    const reloaded = client(Object.fromEntries(c.storage), a, { [fav]: [] })
    await reloaded.window.EUCuenta.ready
    expect(reloaded.remote.A[fav]).toEqual([station('one')])
    expect(JSON.parse(reloaded.storage.get(fav)!)).toEqual([station('one')])
    put.resolve(null); await removing
  })

  it('keeps a confirmed deletion through an old KV read and reload without uploading an old list', async () => {
    const c = client({}, a, { [fav]: [station('one')] }); await c.window.EUCuenta.ready
    c.storage.set(fav, '[]'); await c.window.EUCuenta.changed(fav)
    c.remote.A[fav] = [station('one')]
    await c.window.EUCuenta.refresh()
    expect(JSON.parse(c.storage.get(fav)!)).toEqual([])
    expect(c.writes()).toHaveLength(1)
    const reloaded = client(Object.fromEntries(c.storage), a, { [fav]: [station('one')] })
    await reloaded.window.EUCuenta.ready
    expect(JSON.parse(reloaded.storage.get(fav)!)).toEqual([])
    expect(reloaded.writes()).toHaveLength(0)
    reloaded.remote.A[fav] = []
    await reloaded.window.EUCuenta.refresh()
    expect(JSON.parse(reloaded.storage.get('eu-cuenta-confirmado-v1:A')!)).toEqual({})
    reloaded.remote.A[fav] = [station('new-device')]
    await reloaded.window.EUCuenta.refresh()
    expect(JSON.parse(reloaded.storage.get(fav)!)).toEqual([station('new-device')])
  })

  it.each([503, 429, 'network'] as const)('automatically saves after a temporary PUT failure (%s) without a focus event', async failure => {
    vi.useFakeTimers()
    const c = client({}, a, { [fav]: [] }); await c.window.EUCuenta.ready
    c.failPut(failure); c.storage.set(fav, JSON.stringify([station('retry')]))
    await c.window.EUCuenta.changed(fav)
    expect(c.window.EUCuenta.status).toBe('pending')
    expect(c.writes()).toHaveLength(1)
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].value).toEqual([station('retry')])
    await vi.advanceTimersByTimeAsync(1499)
    expect(c.writes()).toHaveLength(1)
    c.failPut(0)
    await vi.advanceTimersByTimeAsync(1); await settle()
    expect(c.writes()).toHaveLength(2)
    expect(c.remote.A[fav]).toEqual([station('retry')])
    expect(c.window.EUCuenta.status).toBe('saved')
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains a rejected oversized queue without repeatedly sending the same 413 response', async () => {
    vi.useFakeTimers()
    const c = client({}, a, { [fav]: [] }); await c.window.EUCuenta.ready
    c.failPut(413); c.storage.set(fav, JSON.stringify([station('rejected')]))
    await c.window.EUCuenta.changed(fav)
    await vi.advanceTimersByTimeAsync(600000)
    expect(c.writes()).toHaveLength(1)
    expect(c.remote.A[fav]).toEqual([])
    expect(c.window.EUCuenta.status).toBe('pending')
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].value).toEqual([station('rejected')])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels automatic retries on logout while retaining the old account’s pending queue', async () => {
    vi.useFakeTimers()
    const c = client({}, a, { [fav]: [] }); await c.window.EUCuenta.ready
    c.failPut(503); c.storage.set(fav, JSON.stringify([station('pending-A')]))
    await c.window.EUCuenta.changed(fav)
    c.emit('btn-logout:click'); await settle()
    await vi.advanceTimersByTimeAsync(600000)
    expect(c.window.EUCuenta.user).toBeNull()
    expect(c.writes()).toHaveLength(1)
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)[fav].value).toEqual([station('pending-A')])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends large favorite lists without keepalive and clears the durable queue only after success', async () => {
    const c = client({}, a, { [fav]: [] }); await c.window.EUCuenta.ready
    const favorites = Array.from({ length: 100 }, (_, index) => ({ id: String(index), rotulo: 'R'.repeat(200) }))
    c.storage.set(fav, JSON.stringify(favorites))
    await c.window.EUCuenta.changed(fav)
    expect(c.writes()[0][1].body.length).toBeGreaterThan(16000)
    expect(c.writes()[0][1].keepalive).toBe(false)
    expect(c.remote.A[fav]).toEqual(favorites)
    expect(JSON.parse(c.storage.get('eu-cuenta-pendientes-v1:A')!)).toEqual({})
  })
})
