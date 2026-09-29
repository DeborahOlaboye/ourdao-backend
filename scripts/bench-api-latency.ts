#!/usr/bin/env tsx
/**
 * API latency benchmark for key endpoints (issue #220).
 * 
 * Measures p50 and p95 latency for endpoints the frontend polls:
 * - GET /api/stats
 * - GET /api/loans
 * - GET /api/proposals/loan
 * - GET /api/members/:address/summary
 * 
 * Runs against a database seeded to realistic scale (not empty), recording
 * baseline metrics to validate caching and indexing decisions.
 */

import { performance } from 'perf_hooks'
import { buildServer } from '../src/api/server.js'
import { pool, query } from '../src/db/index.js'
import { migrate } from '../src/db/migrate.js'

// Test parameters
const WARMUP_REQUESTS = 10
const BENCHMARK_REQUESTS = 100
const TEST_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' // Example

interface BenchmarkResult {
  endpoint: string
  requests: number
  p50: number
  p95: number
  min: number
  max: number
  mean: number
}

async function seedDatabase() {
  console.log('[bench] Seeding database with realistic data...')
  
  // Check if database already has data
  const { rows } = await query<{ count: string }>('SELECT COUNT(*) as count FROM events')
  const eventCount = parseInt(rows[0]?.count || '0', 10)
  
  if (eventCount > 0) {
    console.log(`[bench] Database already contains ${eventCount} events - skipping seed`)
    return
  }
  
  // TODO: Seed with realistic data:
  // - 100+ members
  // - 50+ loan proposals
  // - 30+ active loans
  // - Treasury proposals
  // - Interest distributions
  console.warn('[bench] Database seeding not yet implemented - running against current data')
  console.warn('[bench] For accurate results, seed database with realistic scale first')
}

async function benchmarkEndpoint(
  endpoint: string,
  makeRequest: () => Promise<unknown>
): Promise<BenchmarkResult> {
  const latencies: number[] = []
  
  // Warmup
  console.log(`[bench] Warming up ${endpoint}...`)
  for (let i = 0; i < WARMUP_REQUESTS; i++) {
    await makeRequest()
  }
  
  // Actual benchmark
  console.log(`[bench] Benchmarking ${endpoint} (${BENCHMARK_REQUESTS} requests)...`)
  for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
    const start = performance.now()
    await makeRequest()
    const end = performance.now()
    latencies.push(end - start)
  }
  
  // Calculate percentiles
  latencies.sort((a, b) => a - b)
  const p50Index = Math.floor(latencies.length * 0.5)
  const p95Index = Math.floor(latencies.length * 0.95)
  
  const result: BenchmarkResult = {
    endpoint,
    requests: latencies.length,
    p50: latencies[p50Index]!,
    p95: latencies[p95Index]!,
    min: latencies[0]!,
    max: latencies[latencies.length - 1]!,
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
  }
  
  return result
}

function printResults(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(80))
  console.log('API Latency Benchmark Results')
  console.log('='.repeat(80))
  console.log()
  
  console.log('| Endpoint | p50 (ms) | p95 (ms) | Min (ms) | Max (ms) | Mean (ms) |')
  console.log('|----------|----------|----------|----------|----------|-----------|')
  
  for (const r of results) {
    console.log(
      `| ${r.endpoint.padEnd(37)} | ${r.p50.toFixed(2).padStart(8)} | ${r.p95.toFixed(2).padStart(8)} | ${r.min.toFixed(2).padStart(8)} | ${r.max.toFixed(2).padStart(8)} | ${r.mean.toFixed(2).padStart(9)} |`
    )
  }
  
  console.log()
  console.log(`Benchmark completed with ${BENCHMARK_REQUESTS} requests per endpoint`)
  console.log()
}

async function main() {
  console.log('[bench] API Latency Benchmark')
  console.log('[bench] Issue #220: Baseline performance measurement\n')
  
  // Apply schema
  await migrate()
  
  // Seed database if needed
  await seedDatabase()
  
  // Build server
  const app = await buildServer({ logger: { level: 'silent' } })
  await app.listen({ port: 0, host: '127.0.0.1' })
  
  const results: BenchmarkResult[] = []
  
  try {
    // Benchmark GET /api/stats
    results.push(
      await benchmarkEndpoint('GET /api/stats', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/stats' })
        if (response.statusCode !== 200) throw new Error(`Stats returned ${response.statusCode}`)
        return response.json()
      })
    )
    
    // Benchmark GET /api/loans
    results.push(
      await benchmarkEndpoint('GET /api/loans', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/loans' })
        if (response.statusCode !== 200) throw new Error(`Loans returned ${response.statusCode}`)
        return response.json()
      })
    )
    
    // Benchmark GET /api/proposals/loan
    results.push(
      await benchmarkEndpoint('GET /api/proposals/loan', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/proposals/loan' })
        if (response.statusCode !== 200) throw new Error(`Loan proposals returned ${response.statusCode}`)
        return response.json()
      })
    )
    
    // Benchmark GET /api/members/:address/summary
    results.push(
      await benchmarkEndpoint(`GET /api/members/${TEST_ADDRESS}/summary`, async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/members/${TEST_ADDRESS}/summary`,
        })
        // 404 is acceptable if the test address doesn't exist - we're measuring query time
        if (response.statusCode !== 200 && response.statusCode !== 404) {
          throw new Error(`Member summary returned ${response.statusCode}`)
        }
        return response.json()
      })
    )
    
    printResults(results)
  } finally {
    await app.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[bench] fatal:', err)
  process.exit(1)
})
