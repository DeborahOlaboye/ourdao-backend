#!/usr/bin/env tsx
/**
 * Validate all npm dependencies against the approved license policy.
 * 
 * This script checks that every dependency uses a license on the approved list
 * documented in docs/DEPENDENCY-LICENSES.md. CI fails if a dependency has a
 * disallowed license or no license information.
 * 
 * Issue #218: ensures no copyleft or unlicensed dependencies enter the tree
 * unreviewed.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Approved licenses per docs/DEPENDENCY-LICENSES.md
const APPROVED_LICENSES = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'CC0-1.0',
  'CC-BY-3.0',
  '(MIT AND CC-BY-3.0)', // Dual license - we choose MIT
])

// Disallowed licenses (strong copyleft, network copyleft, no license)
const DISALLOWED_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-2.0',
  'LGPL-3.0',
  'AGPL-3.0',
  'UNLICENSED',
])

interface LicenseInfo {
  licenses: string
  repository?: string
  publisher?: string
  email?: string
}

async function main() {
  console.log('[license-check] Validating dependency licenses...\n')

  let output: string
  try {
    const result = await execAsync('npx license-checker --json')
    output = result.stdout
  } catch (err) {
    console.error('[license-check] Failed to run license-checker:', err)
    process.exit(1)
  }

  const licenses: Record<string, LicenseInfo> = JSON.parse(output)
  const violations: Array<{ pkg: string; license: string; reason: string }> = []
  const summary: Record<string, number> = {}

  for (const [pkg, info] of Object.entries(licenses)) {
    // Exclude this repository itself - it shows as UNLICENSED because package.json
    // has no license field (LICENSE file covers it at repo root)
    if (pkg.startsWith('ourdao-backend@')) {
      continue
    }

    const license = info.licenses || 'UNLICENSED'

    // Count licenses for summary
    summary[license] = (summary[license] || 0) + 1

    // Check if license is explicitly disallowed
    if (DISALLOWED_LICENSES.has(license)) {
      violations.push({
        pkg,
        license,
        reason: `Disallowed license: ${license} is not compatible with MIT`,
      })
      continue
    }

    // Check if license is on the approved list
    if (!APPROVED_LICENSES.has(license)) {
      violations.push({
        pkg,
        license,
        reason: `License not on approved list: ${license} requires review`,
      })
    }
  }

  // Print summary
  console.log('License summary:')
  const sortedLicenses = Object.entries(summary).sort((a, b) => b[1] - a[1])
  for (const [license, count] of sortedLicenses) {
    const status = APPROVED_LICENSES.has(license) ? '✅' : '❌'
    console.log(`  ${status} ${license}: ${count}`)
  }
  console.log()

  // Report violations
  if (violations.length > 0) {
    console.error(`[license-check] ❌ Found ${violations.length} license violation(s):\n`)
    for (const v of violations) {
      console.error(`  Package: ${v.pkg}`)
      console.error(`  License: ${v.license}`)
      console.error(`  Reason:  ${v.reason}`)
      console.error()
    }
    console.error('See docs/DEPENDENCY-LICENSES.md for the approved license list.')
    console.error('Disallowed licenses must be removed or replaced.')
    process.exit(1)
  }

  console.log('[license-check] ✅ All dependencies use approved licenses\n')
  console.log(`Total packages checked: ${Object.keys(licenses).length}`)
  console.log(`Approved licenses: ${APPROVED_LICENSES.size}`)
  console.log(`Violations: 0`)
}

main().catch((err) => {
  console.error('[license-check] Unexpected error:', err)
  process.exit(1)
})
