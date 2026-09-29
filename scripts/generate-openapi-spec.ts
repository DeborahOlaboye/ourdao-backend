#!/usr/bin/env tsx
/**
 * Generate OpenAPI specification from Fastify routes.
 * 
 * This script builds the Fastify server and extracts its OpenAPI spec,
 * writing it to openapi.json at the repository root. CI fails if the
 * committed spec diverges from what the routes actually produce (issue #215).
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { buildServer } from '../src/api/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = join(__dirname, '../openapi.json')

async function main() {
  // Set DATABASE_URL to a dummy value so buildServer doesn't fail
  // (the actual DB connection isn't used during spec generation)
  process.env.DATABASE_URL ??= 'postgresql://dummy:dummy@localhost:5432/dummy'
  process.env.CONTRACT_ID ??= 'CDUMMY'
  process.env.SOROBAN_RPC_URL ??= 'https://soroban-testnet.stellar.org'
  process.env.LOG_LEVEL = 'silent'

  const app = await buildServer()
  
  // Wait for all plugins to be registered
  await app.ready()
  
  // Fastify's swagger plugin adds a .swagger() method to the instance
  const spec = (app as unknown as { swagger: () => unknown }).swagger()
  
  await app.close()

  const formatted = JSON.stringify(spec, null, 2)
  writeFileSync(OUTPUT_PATH, formatted + '\n', 'utf-8')
  
  console.log(`[openapi] wrote ${OUTPUT_PATH}`)
  console.log(`[openapi] spec version: ${(spec as { info?: { version?: string } }).info?.version}`)
}

main().catch((err) => {
  console.error('[openapi] generation failed:', err)
  process.exit(1)
})
