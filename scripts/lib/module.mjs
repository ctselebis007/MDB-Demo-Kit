// Shared helpers for new-demo / add-module: module.json validation, copying, README rendering.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BUILTIN = ['setup']
const NAME_RE = /^[a-z][a-z0-9-]*$/
const SKIP = new Set(['node_modules', '.venv', 'dist', '__pycache__', '.pytest_cache', '.ruff_cache', '.DS_Store', 'settings.json'])

export const pyName = (name) => name.replaceAll('-', '_')

export function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function kitModules(kitRoot = KIT_ROOT) {
  const dir = join(kitRoot, 'modules')
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'module.json')))
}

export function loadKitModule(kitRoot, name) {
  const path = join(kitRoot, 'modules', name, 'module.json')
  if (!existsSync(path)) throw new Error(`Unknown module '${name}'. Available: ${kitModules(kitRoot).join(', ')}`)
  return readManifest(path)
}

/** Manifests of modules already installed in a demo (copied to api/app/modules/<py>/module.json). */
export function installedModules(demoRoot) {
  const dir = join(demoRoot, 'api', 'app', 'modules')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((d) => join(dir, d, 'module.json'))
    .filter(existsSync)
    .map(readManifest)
}

/**
 * Returns a list of error strings (empty = valid).
 * `selected` are the manifests being installed; `existing` are already in the demo.
 */
export function validateModules(selected, existing = []) {
  const errors = []
  const all = [...existing, ...selected]
  const names = new Set([...BUILTIN, ...all.map((m) => m?.name).filter(Boolean)])
  const owner = new Map()
  for (const m of all) {
    if (!m || typeof m.name !== 'string' || !NAME_RE.test(m.name)) {
      errors.push(`module.json: missing or invalid "name" (${JSON.stringify(m?.name)})`)
      continue
    }
    for (const req of m.requires ?? []) {
      if (!names.has(req)) errors.push(`${m.name}: requires unknown module '${req}'`)
    }
    for (const field of ['requires', 'python', 'npm', 'collections', 'codeMap']) {
      if (m[field] !== undefined && !Array.isArray(m[field])) errors.push(`${m.name}: "${field}" must be an array`)
    }
    for (const c of m.collections ?? []) {
      if (owner.has(c)) errors.push(`collection '${c}' is used by both ${owner.get(c)} and ${m.name}`)
      else owner.set(c, m.name)
    }
    for (const entry of m.codeMap ?? []) {
      if (!entry.feature || !entry.file) errors.push(`${m.name}: codeMap entries need "feature" and "file"`)
    }
  }
  return errors
}

function copyFilter(src) {
  return !SKIP.has(basename(src))
}

export function copyTemplate(kitRoot, target) {
  cpSync(join(kitRoot, 'template'), target, { recursive: true, filter: copyFilter })
}

export function copyModule(kitRoot, demoRoot, manifest) {
  const src = join(kitRoot, 'modules', manifest.name)
  const apiDest = join(demoRoot, 'api', 'app', 'modules', pyName(manifest.name))
  const webDest = join(demoRoot, 'web', 'src', 'modules', manifest.name)
  if (existsSync(apiDest) || existsSync(webDest)) {
    throw new Error(`Module '${manifest.name}' is already installed (${relative(demoRoot, apiDest)})`)
  }
  cpSync(join(src, 'api'), apiDest, { recursive: true, filter: copyFilter })
  if (existsSync(join(src, 'web'))) cpSync(join(src, 'web'), webDest, { recursive: true, filter: copyFilter })
  cpSync(join(src, 'module.json'), join(apiDest, 'module.json'))
}

function replaceBlock(text, name, body) {
  const start = `<!-- ${name}:start -->`
  const end = `<!-- ${name}:end -->`
  const i = text.indexOf(start)
  const j = text.indexOf(end)
  if (i < 0 || j < 0) throw new Error(`README.md is missing ${start} / ${end} markers`)
  return `${text.slice(0, i + start.length)}\n${body}\n${text.slice(j)}`
}

/** Renders the README "What it demonstrates" bullets and "Where's the MongoDB code?" table. */
export function renderCodeMap(demoRoot) {
  const readme = join(demoRoot, 'README.md')
  const modules = installedModules(demoRoot).sort((a, b) => a.name.localeCompare(b.name))
  const entries = modules.flatMap((m) => m.codeMap ?? [])
  const features = [
    '- Setup page: connection test, deterministic seeding with embeddings, Search and Vector index builds',
    ...entries.map((c) => `- ${c.feature}${c.docsUrl ? ` ([docs](${c.docsUrl}))` : ''}`),
  ].join('\n')
  const table = [
    '| Feature | File | MongoDB docs |',
    '|---|---|---|',
    '| Setup: settings, connection test, seeding, index builds | [`api/app/core/setup.py`](api/app/core/setup.py) | [docs](https://www.mongodb.com/docs/atlas/atlas-search/manage-indexes/) |',
    ...entries.map((c) => `| ${c.feature} | [\`${c.file}\`](${c.file}) | ${c.docsUrl ? `[docs](${c.docsUrl})` : ''} |`),
  ].join('\n')
  let text = readFileSync(readme, 'utf8')
  text = replaceBlock(text, 'features', features)
  text = replaceBlock(text, 'codemap', table)
  writeFileSync(readme, text)
}

export function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(' ')}`)
}

export function installDeps(demoRoot, manifests, { full = false } = {}) {
  const python = [...new Set(manifests.flatMap((m) => m.python ?? []))]
  const npm = [...new Set(manifests.flatMap((m) => m.npm ?? []))]
  if (full) run('npm', ['install'], demoRoot)
  if (npm.length) run('npm', ['install', '-w', 'web', ...npm], demoRoot)
  if (python.length) run('uv', ['add', '--directory', 'api', ...python], demoRoot)
  else run('uv', ['sync', '--directory', 'api'], demoRoot)
  run('npm', ['run', 'gen:types'], demoRoot)
}

export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=', 2)
      if (inline !== undefined) flags[key] = inline
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i]
      else flags[key] = true
    } else positional.push(a)
  }
  return { positional, flags }
}
