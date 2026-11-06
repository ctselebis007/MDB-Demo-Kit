#!/usr/bin/env node
// Run inside a generated demo:
//   node <kit>/scripts/add-module.mjs <module> [--kit <path>] [--skip-install]
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  KIT_ROOT,
  copyModule,
  installDeps,
  installedModules,
  kitModules,
  loadKitModule,
  parseArgs,
  renderCodeMap,
  validateModules,
} from './lib/module.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const kitRoot = resolve(typeof flags.kit === 'string' ? flags.kit : KIT_ROOT)
const demoRoot = resolve(typeof flags.demo === 'string' ? flags.demo : process.cwd())
const name = positional[0]

if (!name) {
  console.error(`Usage: add-module <module> [--kit <path>]\nModules: ${kitModules(kitRoot).join(', ')}`)
  process.exit(1)
}
if (!existsSync(join(demoRoot, 'api', 'app', 'modules')) || !existsSync(join(demoRoot, 'web', 'src'))) {
  console.error(`✗ ${demoRoot} does not look like a generated demo (run inside the demo or pass --demo)`)
  process.exit(1)
}

const manifest = loadKitModule(kitRoot, name)
const errors = validateModules([manifest], installedModules(demoRoot).filter((m) => m.name !== name))
if (installedModules(demoRoot).some((m) => m.name === name)) errors.push(`module '${name}' is already installed`)
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'))
  process.exit(1)
}

copyModule(kitRoot, demoRoot, manifest)
renderCodeMap(demoRoot)
if (!flags['skip-install']) installDeps(demoRoot, [manifest])
console.log(`✓ Added ${name}. Restart \`npm run dev\`, then Seed and Create Indexes on Setup.`)
