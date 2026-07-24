const STORAGE_KEY = 'unico_laser_quote_workspace_v1'
const DEFAULTS_KEY = 'unico_laser_quote_defaults_v1'
const KINDS = ['products', 'customers', 'quotes']

const emptyWorkspace = () => ({ products: [], customers: [], quotes: [] })

function validWorkspace(value) {
  const workspace = emptyWorkspace()
  for (const kind of KINDS) {
    workspace[kind] = Array.isArray(value?.[kind]) ? value[kind].filter(Boolean) : []
  }
  return workspace
}

export function loadLocalQuoteWorkspace(storage = globalThis.localStorage) {
  try {
    return validWorkspace(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'))
  } catch {
    return emptyWorkspace()
  }
}

export function saveLocalQuoteEntity(kind, entity, storage = globalThis.localStorage) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown quote workspace kind: ${kind}`)
  const workspace = loadLocalQuoteWorkspace(storage)
  const now = Date.now()
  const id = entity?.id || `local_${now}_${Math.random().toString(36).slice(2, 8)}`
  const record = {
    ...entity,
    id,
    createdAt: entity?.createdAt || now,
    updatedAt: now,
  }
  workspace[kind] = [
    record,
    ...workspace[kind].filter((item) => item.id !== id),
  ].slice(0, kind === 'quotes' ? 100 : 200)
  storage?.setItem(STORAGE_KEY, JSON.stringify(workspace))
  return record
}

export function mergeQuoteWorkspaces(...workspaces) {
  const merged = emptyWorkspace()
  for (const kind of KINDS) {
    const byId = new Map()
    for (const workspace of workspaces) {
      for (const item of workspace?.[kind] || []) {
        const key = item.id || `${item.name || item.customerName || ''}_${item.createdAt || ''}`
        const current = byId.get(key)
        if (!current || (item.updatedAt || item.createdAt || 0) >= (current.updatedAt || current.createdAt || 0)) {
          byId.set(key, item)
        }
      }
    }
    merged[kind] = [...byId.values()].sort((a, b) =>
      (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  }
  return merged
}

export function loadLocalQuoteDefaults(fallback = {}, storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(DEFAULTS_KEY) || 'null')
    return saved && typeof saved === 'object' ? { ...fallback, ...saved } : { ...fallback }
  } catch {
    return { ...fallback }
  }
}

export function saveLocalQuoteDefaults(defaults, storage = globalThis.localStorage) {
  const saved = { ...defaults }
  storage?.setItem(DEFAULTS_KEY, JSON.stringify(saved))
  return saved
}

export { DEFAULTS_KEY as QUOTE_DEFAULTS_KEY, STORAGE_KEY as QUOTE_STORAGE_KEY }
