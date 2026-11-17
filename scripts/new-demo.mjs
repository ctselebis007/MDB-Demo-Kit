#!/usr/bin/env node
// Usage: npm run new -- <name> [--modules search-lab,graph-view] [--out ../] [--skip-install]
// Omit --modules for a blank starter: Setup page, core API/web and tooling only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  KIT_ROOT,
  copyModule,
  copyTemplate,
  installDeps,
  kitModules,
  loadKitModule,
  parseArgs,
  renderCodeMap,
  run,
  validateModules,
} from './lib/module.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const name = positional[0]
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Usage: npm run new -- <name> [--modules a,b] [--out <dir>] [--skip-install]')
  console.error('Omit --modules for a blank starter (Setup only).')
  console.error(`Modules: ${kitModules().join(', ')}`)
  process.exit(1)
}

const moduleNames = typeof flags.modules === 'string' ? flags.modules.split(',').map((s) => s.trim()).filter(Boolean) : []
const manifests = moduleNames.map((m) => loadKitModule(KIT_ROOT, m))
const errors = validateModules(manifests)
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'))
  process.exit(1)
}

const outDir = resolve(typeof flags.out === 'string' ? flags.out : join(KIT_ROOT, '..'))
const target = join(outDir, name)
if (existsSync(target)) {
  console.error(`✗ ${target} already exists`)
  process.exit(1)
}

copyTemplate(KIT_ROOT, target)
const pkgPath = join(target, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, name }, null, 2)}\n`)
const readme = join(target, 'README.md')
writeFileSync(readme, readFileSync(readme, 'utf8').replaceAll('{{DEMO_NAME}}', name))

for (const m of manifests) copyModule(KIT_ROOT, target, m)
renderCodeMap(target)

if (!flags['skip-install']) installDeps(target, manifests, { full: true })
try {
  run('git', ['init', '-q'], target)
} catch {
  console.warn('git init failed; skipping')
}

console.log(`\n✓ Created ${target} with modules: ${moduleNames.join(', ') || '(none, blank starter)'}`)
console.log(`\n  cd ${target}\n  ${flags['skip-install'] ? 'npm install && ' : ''}npm run dev\n`)
if (!moduleNames.length) console.log('  Add your own module: see "Build your own module" in the generated README.\n')
