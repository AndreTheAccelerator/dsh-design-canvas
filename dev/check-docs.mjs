/**
 * Validate the harness scenario documents against the real document model.
 *
 * A scenario is only useful if it is a *legal* board: exactly what the Host would persist, not a
 * hand-edited file that the app has to repair. This script normalizes every `dev/docs/*.json`
 * with `normalizeDoc` from `host/model.js` and fails when normalization would change anything, so
 * an authoring mistake (unknown prop, out-of-range value, dangling comment target, duplicate id)
 * shows up here instead of silently disappearing in the UI.
 *
 * Usage: node dev/check-docs.mjs
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeDoc } from '../host/model.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = path.join(HERE, 'docs')

function countLayers(doc) {
  let total = 0
  const walk = (layers) => {
    for (const layer of layers || []) {
      total += 1
      if (layer.type === 'frame') walk(layer.children)
    }
  }
  for (const artboard of doc.artboards || []) walk(artboard.layers)
  return total
}

/** First path where two JSON values differ, e.g. `artboards[0].layers[3].fill`. */
function firstDifference(expected, actual, at = '$') {
  if (expected === actual) return ''
  if (typeof expected !== typeof actual || expected === null || actual === null) return at
  if (Array.isArray(expected) !== Array.isArray(actual)) return at
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) return `${at}.length (${expected.length} vs ${actual.length})`
    for (let index = 0; index < expected.length; index += 1) {
      const found = firstDifference(expected[index], actual[index], `${at}[${index}]`)
      if (found) return found
    }
    return ''
  }
  if (typeof expected === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of keys) {
      if (!(key in expected)) return `${at}.${key} (added by normalizeDoc)`
      if (!(key in actual)) return `${at}.${key} (dropped by normalizeDoc)`
      const found = firstDifference(expected[key], actual[key], `${at}.${key}`)
      if (found) return found
    }
    return ''
  }
  return `${at} (${JSON.stringify(expected)} vs ${JSON.stringify(actual)})`
}

async function main() {
  let names
  try {
    names = (await readdir(DOCS_DIR)).filter((name) => name.endsWith('.json')).sort()
  } catch {
    console.error(`no scenario directory at ${DOCS_DIR}`)
    process.exitCode = 1
    return
  }
  if (names.length === 0) {
    console.error(`no scenario documents in ${DOCS_DIR}`)
    process.exitCode = 1
    return
  }

  let failures = 0
  for (const name of names) {
    const file = path.join(DOCS_DIR, name)
    let raw
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      console.error(`FAIL ${name}: not valid JSON — ${error.message}`)
      failures += 1
      continue
    }
    const normalized = normalizeDoc(raw)
    const stable = JSON.stringify(raw) === JSON.stringify(normalized)
    if (stable) {
      console.log(
        `ok   ${name}  ${normalized.artboards.length} artboards, ${countLayers(normalized)} layers, ${normalized.comments.length} comments`,
      )
    } else {
      failures += 1
      console.error(`FAIL ${name}: normalizeDoc would rewrite it`)
      console.error(`     first difference: ${firstDifference(raw, normalized)}`)
      console.error('     fix the file (or regenerate it) so the stored form is already normalized')
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} scenario file(s) are not normalize-stable`)
    process.exitCode = 1
    return
  }
  console.log(`\nall ${names.length} scenario files are normalize-stable`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
