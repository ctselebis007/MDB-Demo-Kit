import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { after, describe, it } from 'node:test'
import { KIT_ROOT, loadKitModule, validateModules } from '../lib/module.mjs'

describe('validateModules', () => {
  const search = loadKitModule(KIT_ROOT, 'search-lab')
  const graph = loadKitModule(KIT_ROOT, 'graph-view')

  it('accepts the kit modules together', () => {
    assert.deepEqual(validateModules([search, graph]), [])
  })

  it('rejects a missing name', () => {
    assert.match(validateModules([{ ...search, name: undefined }]).join(), /missing or invalid "name"/)
  })

  it('rejects unknown requires', () => {
    assert.match(validateModules([{ ...search, requires: ['setup', 'nope'] }]).join(), /requires unknown module 'nope'/)
  })

  it('rejects duplicate collection names across modules', () => {
    const clash = { ...graph, collections: ['products'] }
    assert.match(validateModules([search, clash]).join(), /collection 'products' is used by both/)
  })

  it('checks against modules already installed', () => {
    assert.match(validateModules([search], [search]).join(), /collection 'products'/)
  })
})

function tree(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name !== '.git') walk(p)
      } else if (!/(package-lock\.json|uv\.lock)$/.test(name)) {
        out.push([relative(root, p), readFileSync(p, 'utf8')])
      }
    }
  }
  walk(root)
  return new Map(out.sort(([a], [b]) => a.localeCompare(b)))
}

function node(args, cwd = KIT_ROOT) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr || r.stdout)
  return r
}

describe('scaffolding', () => {
  const out = mkdtempSync(join(tmpdir(), 'demokit-scaffold-'))
  after(() => rmSync(out, { recursive: true, force: true }))

  it('creates a blank starter when --modules is omitted', () => {
    node(['scripts/new-demo.mjs', 'blank', '--out', out, '--skip-install'])
    const blank = tree(join(out, 'blank'))
    const modulePaths = [...blank.keys()].filter((p) => /^(api\/app|web\/src)\/modules\/[^/]+\//.test(p))
    assert.deepEqual(modulePaths, [])
    assert.ok(blank.has('api/app/modules/__init__.py'))
    assert.ok(blank.has('api/app/core/setup.py'))
    for (const f of ['.github/copilot-instructions.md', '.github/skills/brainstorm/SKILL.md', '.github/skills/brainstorming/SKILL.md', 'docs/plans/.gitkeep']) {
      assert.ok(blank.has(f), f)
    }
    assert.ok(statSync(join(out, 'blank', 'TempAssets')).isDirectory())
    const readme = blank.get('README.md')
    assert.match(readme, /^# blank$/m)
    assert.match(readme, /## Build your own module/)
    assert.match(readme, /## Design with AI agents/)
    assert.doesNotMatch(readme, /api\/app\/modules\/\w+\/pipelines\.py/)
    assert.equal(JSON.parse(blank.get('package.json')).name, 'blank')
  })

  it('add-module yields the same tree as generating both modules at once', () => {
    node(['scripts/new-demo.mjs', 'both', '--modules', 'search-lab,graph-view', '--out', out, '--skip-install'])
    node(['scripts/new-demo.mjs', 'one', '--modules', 'search-lab', '--out', out, '--skip-install'])
    node([join(KIT_ROOT, 'scripts/add-module.mjs'), 'graph-view', '--skip-install'], join(out, 'one'))

    const both = tree(join(out, 'both'))
    const one = tree(join(out, 'one'))
    const normalize = (s) => s.replaceAll('"one"', '"both"').replace(/^# one$/m, '# both')
    assert.deepEqual([...one.keys()], [...both.keys()])
    for (const [path, content] of both) assert.equal(normalize(one.get(path)), content, path)
    assert.match(both.get('README.md'), /api\/app\/modules\/graph_view\/pipelines\.py/)
  })

  it('refuses an existing target and a duplicate module', () => {
    const again = spawnSync(process.execPath, ['scripts/new-demo.mjs', 'both', '--modules', 'search-lab', '--out', out, '--skip-install'], {
      cwd: KIT_ROOT,
      encoding: 'utf8',
    })
    assert.notEqual(again.status, 0)
    const dup = spawnSync(process.execPath, [join(KIT_ROOT, 'scripts/add-module.mjs'), 'search-lab', '--skip-install'], {
      cwd: join(out, 'both'),
      encoding: 'utf8',
    })
    assert.notEqual(dup.status, 0)
    assert.match(dup.stderr, /already installed|used by both/)
  })
})
