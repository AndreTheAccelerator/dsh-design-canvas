/**
 * Assemble the browser half (`client.js`) from the source parts in `src/client/`.
 *
 * The plugin ships ONE browser artifact (`client.js`) because the Harness module loader
 * registers a single lazy factory per package. That artifact is generated: edit the parts,
 * run `npm run build`, commit both. `npm run build -- --check` exits non-zero when the
 * committed artifact is stale (CI runs it, so a forgotten rebuild fails the build instead
 * of shipping an old client).
 *
 * Parts are concatenated in manifest order into one function body, so they share a single
 * module scope: `function` declarations hoist across parts, and every `const` is
 * initialized when the factory runs (top to bottom). Keep new top-level constants free of
 * cross-part references unless the referenced part comes earlier in MANIFEST.
 *
 * Usage:
 *   node scripts/build-client.mjs                     write client.js
 *   node scripts/build-client.mjs --check             verify client.js matches the parts
 *   node scripts/build-client.mjs --out <path>        write the bundle somewhere else (a
 *                                                     scratch file for `node --check` while
 *                                                     several authors edit parts in parallel)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..')
export const PARTS_DIR = path.join(ROOT, 'src', 'client')
export const ARTIFACT = path.join(ROOT, 'client.js')

/**
 * Build order. Each entry is one file in `src/client/`. The order is the order inside the
 * generated factory body, so earlier parts must not depend on later parts at load time.
 * Ownership is documented in CONTRACT.md.
 */
export const MANIFEST = [
  '00-core.js',
  '10-strings.js',
  '20-http.js',
  '25-doc.js',
  '26-camera.js',
  '27-images.js',
  '28-layout.js',
  '30-defaults.js',
  '35-comment-msg.js',
  '40-icons.js',
  '42-css.js',
  '43-export-code.js',
  '44-export-ui.js',
  '45-primitives.js',
  '50-tree.js',
  '52-comments.js',
  '53-batch.js',
  '55-inspector.js',
  '59-selection.js',
  '60-render.js',
  '65-boundary.js',
  '70-editor.js',
  '74-shell.js',
  '80-boot.js',
]

/**
 * Concatenate the parts verbatim. Every part ends with exactly one newline, so the artifact
 * is a plain byte-for-byte join (no separators inserted, no trailing newline rewritten).
 */
async function assemble() {
  const chunks = []
  for (const name of MANIFEST) {
    const file = path.join(PARTS_DIR, name)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      throw new Error(`missing client part ${name}: ${error.message}`)
    }
    if (!text.endsWith('\n')) throw new Error(`client part ${name} must end with a newline`)
    chunks.push(text)
  }
  return chunks.join('')
}

async function main() {
  const check = process.argv.includes('--check')
  const outIndex = process.argv.indexOf('--out')
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : ''
  const source = await assemble()

  if (check) {
    let current = ''
    try {
      current = await readFile(ARTIFACT, 'utf8')
    } catch {
      current = ''
    }
    if (current !== source) {
      console.error(
        'client.js is stale: run `npm run build` and commit the regenerated bundle.\n' +
          `(parts: ${MANIFEST.length} files in src/client/)`,
      )
      process.exitCode = 1
      return
    }
    console.log(`client.js is up to date (${MANIFEST.length} parts, ${source.length} bytes)`)
    return
  }

  if (outPath) {
    const target = path.resolve(ROOT, outPath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source, 'utf8')
    console.log(`wrote ${target} from ${MANIFEST.length} parts (${source.length} bytes)`)
    return
  }

  await writeFile(ARTIFACT, source, 'utf8')
  console.log(`wrote client.js from ${MANIFEST.length} parts (${source.length} bytes)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
