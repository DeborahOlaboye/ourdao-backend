# Logging

The service logs through [Pino](https://getpino.io) via Fastify's built-in logger. Log output is JSON-formatted by default, suitable for aggregation and structured querying.

## Configuration

Set the `LOG_LEVEL` environment variable to control verbosity:

```bash
LOG_LEVEL=debug npm run dev
```

Valid levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`.

Defaults to `info` if not set. See [docs/DEPLOYMENT.md](./DEPLOYMENT.md#logs) for where output goes in production.

## Log field schema

All log entries are JSON objects with the following structure:

### Standard fields (always present)

| Field | Type | Description |
|-------|------|-------------|
| `level` | number | Numeric log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time` | number | Unix timestamp in milliseconds |
| `pid` | number | Process ID |
| `hostname` | string | Host name of the machine |
| `msg` | string | Human-readable log message |

### Request-scoped fields

When a log entry is emitted during an HTTP request, these additional fields are present:

| Field | Type | Description |
|-------|------|-------------|
| `reqId` | string | Unique request correlation ID (UUIDv4 format) |
| `req` | object | Request details (method, url, remoteAddress, remotePort) |
| `res` | object | Response details (statusCode) — present on request completion logs only |
| `responseTime` | number | Request duration in milliseconds — present on request completion logs only |

### Application-specific fields

Subsystem-specific context appears with a bracket-prefixed tag in the `msg` field (e.g., `[db]`, `[indexer]`, `[auth]`) and may include:

| Field | Type | Description | Notes |
|-------|------|-------------|-------|
| `err` | object | Error details (type, message, stack) | Present on error-level logs |
| `event` | string | Event type or symbol | Indexer and event processing logs |
| `ledger` | number | Ledger sequence number | Indexer logs |
| `address` | string | Stellar address | **Contains user-identifying data** |
| `contract_id` | string | Contract ID | Deployment-specific identifier |

## Fields containing identifying data

The following fields may contain member addresses or other personally identifying values:

| Field | Retention guidance |
|-------|-------------------|
| `address` | Logged at `debug` level in auth flows. Retain according to your data retention policy for user identifiers. Consider masking or redacting in log aggregation. |
| `req.remoteAddress` | Client IP address on every request. Subject to GDPR/privacy regulations if logged. Consider IP anonymization in aggregators. |
| `req.headers` | May contain `Authorization` headers with signatures. **Never index or retain** — signature reuse is a security issue. |

**Default log level is `info`.** Address logging in `src/auth.ts` only occurs at `debug` level, so addresses are not logged in production unless explicitly configured.

## Stable event names for alerting

Operators can build alerts on these message patterns:

| Message pattern | Severity | Meaning |
|----------------|----------|---------|
| `[indexer] LEDGER DISCONTINUITY DETECTED` | `error` | Reorg or chain fork detected — indexer has halted. Requires manual `npm run reindex`. See README "Reorg detection". |
| `[indexer] quarantined event` | `error` | A handler failed deterministically and the event was isolated. Check `/api/admin/failed-events`. See README "Quarantine". |
| `[indexer] poll error` | `error` | RPC polling failed (transient network issue or RPC outage). Includes consecutive failure count and backoff delay. Resolves automatically on recovery. |
| `[indexer] CONTRACT_ID changed` | `warn` | Contract redeployment detected with `INDEXER_RESET_ON_CONTRACT_CHANGE=true`. Derived tables will be wiped. |
| `[db] applied migration` | `info` | A database migration was applied successfully. Normal on first boot after a schema change. |
| `[db] migration failed` | `error` | A migration failed to apply. Process will exit. Requires manual intervention. |
| `[auth] signature verification failed` | `warn` | An authentication attempt with an invalid signature. Normal for misconfigured clients; repeated failures from one IP may indicate an attack. |
| `[auth] could not resolve muxed address` | `warn` | Malformed muxed (M-prefixed) address in auth. Normal for user error. |
| `[stream] client error` | `error` | Server-Sent Events stream client encountered an error. Client will reconnect. |

## Subsystems not yet using Pino

The following subsystems still log through `console.log` / `console.error` and do not include the `reqId` or structured Pino fields. Tracked in issue #132:

- **`src/auth.ts`**: Authentication logs (signature verification, nonce cleanup) use `console.warn`.
- **`src/indexer/poller.ts`**: Some indexer state logs use `console.log` / `console.error`.

Once #132 is resolved, all logs will flow through Pino and include the correlation ID for request-scoped operations.

## Example queries

### Trace one request

Given a request ID from a client error report:

```json
{"reqId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}
```

Query for all log entries with that `reqId`:

```bash
# Generic JSON log aggregator query
jq 'select(.reqId == "a1b2c3d4-e5f6-7890-abcd-ef1234567890")' < app.log
```

### Find every quarantine event

Quarantined events have the message pattern `[indexer] quarantined event`:

```bash
jq 'select(.msg | contains("[indexer] quarantined event"))' < app.log
```

Alternatively, use the `/api/admin/failed-events` endpoint for structured access to quarantined events.

### Find auth failures for an address

**Note:** Addresses are only logged at `debug` level. If `LOG_LEVEL=debug`, search for signature verification failures:

```bash
jq 'select(.msg | contains("[auth] signature verification failed"))' < app.log
```

For a specific address (if logging at `debug`):

```bash
jq 'select(.msg | contains("G...YOURADDRESS"))' < app.log
```

### Find all errors in the last hour

```bash
jq 'select(.level >= 50 and .time > (now - 3600) * 1000)' < app.log
```

### Count errors by subsystem

```bash
jq -r 'select(.level >= 50) | .msg' < app.log \
  | grep -oP '^\[\w+\]' \
  | sort | uniq -c | sort -rn
```

### Monitor indexer catch-up progress

During catch-up, the indexer logs page progress:

```bash
jq 'select(.msg | contains("[indexer] page"))' < app.log
```

Output:
```json
{"level":30,"time":1690000000000,"msg":"[indexer] page 1: ingested 100 event(s) up to ledger 12345"}
{"level":30,"time":1690000001000,"msg":"[indexer] page 2: ingested 100 event(s) up to ledger 12445"}
```

## Output format

By default, Pino outputs newline-delimited JSON (one JSON object per line). For local development, use a pretty-printer:

```bash
npm install -g pino-pretty
npm run dev | pino-pretty
```

In production, ship the raw JSON to your log aggregator (CloudWatch Logs, Datadog, etc.) and query it there.
