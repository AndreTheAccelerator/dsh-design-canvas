/**
 * Download React 18 UMD builds into `dev/vendor/` so the harness also runs without network.
 *
 * The harness page prefers `dev/vendor/` when both files are present and falls back to
 * unpkg.com otherwise, so this script is optional — run it once on a machine that can reach the
 * CDN and the preview keeps working offline afterwards. `dev/vendor/` is gitignored: these are
 * third-party bundles we do not want in the repository history.
 *
 * Usage: node dev/fetch-vendor.mjs [--force]
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = path.join(HERE, 'vendor')

const VERSION = '18.3.1'
const FILES = [
  {
    name: 'react.development.js',
    url: `https://unpkg.com/react@${VERSION}/umd/react.development.js`,
    // Sanity markers: a CDN error page is small and contains none of these.
    markers: ['react.development.js', 'ReactVersion'],
    minBytes: 40_000,
  },
  {
    name: 'react-dom.development.js',
    url: `https://unpkg.com/react-dom@${VERSION}/umd/react-dom.development.js`,
    markers: ['react-dom.development.js', 'createRoot'],
    minBytes: 200_000,
  },
]

const force = process.argv.includes('--force')

async function existing(file) {
  try {
    const info = await stat(file)
    return info.size
  } catch {
    return 0
  }
}

async function download(entry) {
  const target = path.join(VENDOR_DIR, entry.name)
  const present = await existing(target)
  if (present > entry.minBytes && !force) {
    console.log(`  ${entry.name}: already present (${(present / 1024).toFixed(0)} KB) — use --force to refetch`)
    return true
  }

  console.log(`  ${entry.name}: fetching ${entry.url}`)
  const response = await fetch(entry.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${entry.url}`)
  const text = await response.text()
  if (text.length < entry.minBytes) {
    throw new Error(`${entry.name}: response is too small (${text.length} bytes) — not a React bundle`)
  }
  const missing = entry.markers.filter((marker) => !text.includes(marker))
  if (missing.length) {
    throw new Error(`${entry.name}: missing expected markers ${missing.join(', ')} — got an error page?`)
  }
  await writeFile(target, text, 'utf8')
  console.log(`  ${entry.name}: wrote ${(text.length / 1024).toFixed(0)} KB`)
  return true
}

async function main() {
  console.log(`react ${VERSION} UMD -> dev/vendor/`)
  await mkdir(VENDOR_DIR, { recursive: true })
  const results = []
  for (const entry of FILES) {
    try {
      results.push(await download(entry))
    } catch (error) {
      console.error(`  ${entry.name}: FAILED — ${error.message}`)
      results.push(false)
    }
  }
  if (results.every(Boolean)) {
    console.log('\ndone — reload the harness page; it will pick up dev/vendor/ automatically.')
  } else {
    console.error(
      '\nvendoring incomplete. The harness still works while the CDN is reachable ' +
        '(it falls back to unpkg.com); re-run this script on a machine with network access.',
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
