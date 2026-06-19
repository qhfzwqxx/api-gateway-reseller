#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { prisma } from '@gateway/db';

const baseUrl = process.env.IMAGE_LOAD_BASE_URL || 'http://127.0.0.1:4100';
const model = process.env.IMAGE_LOAD_MODEL || 'gpt-image-2';
const endpoint = new URL('/v1/images/generations', baseUrl).toString();
const levels = (process.env.IMAGE_LOAD_LEVELS || '1,2,4,8').split(',').map((v) => Number(v.trim())).filter(Boolean);
const requestsPerLevelMultiplier = Number(process.env.IMAGE_LOAD_REQUESTS_MULTIPLIER || '1');
const timeoutMs = Number(process.env.IMAGE_LOAD_TIMEOUT_MS || '420000');
const size = process.env.IMAGE_LOAD_SIZE || '1024x1024';
const quality = process.env.IMAGE_LOAD_QUALITY || 'low';
const stopOnErrorRate = Number(process.env.IMAGE_LOAD_STOP_ERROR_RATE || '0.35');

const keys = await prisma.apiKey.findMany({
  where: { status: 'ACTIVE', keySecret: { not: null } },
  select: { keySecret: true, keyPrefix: true, rateLimitPerMinute: true, concurrencyLimit: true },
  orderBy: { createdAt: 'desc' },
  take: Number(process.env.IMAGE_LOAD_KEY_COUNT || '20'),
});
const apiKeys = keys.map((k) => k.keySecret).filter(Boolean);
if (apiKeys.length === 0) throw new Error('No active API keys with keySecret found');

console.log(JSON.stringify({ event: 'image_load_start', endpoint, model, levels, keyCount: apiKeys.length, size, quality, timeoutMs }, null, 2));

const summaries = [];
for (const concurrency of levels) {
  const total = Math.max(concurrency, Math.ceil(concurrency * requestsPerLevelMultiplier));
  const summary = await runLevel(concurrency, total);
  summaries.push(summary);
  console.log(JSON.stringify({ event: 'image_load_level_done', ...summary }, null, 2));
  if (summary.errorRate >= stopOnErrorRate || summary.timeoutCount > 0) break;
  await sleep(3000);
}
console.log(JSON.stringify({ event: 'image_load_done', summaries }, null, 2));
await prisma.$disconnect();

async function runLevel(concurrency, total) {
  let next = 0;
  const results = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
    while (next < total) {
      const index = next++;
      results.push(await sendOne(index, worker));
    }
  }));
  const elapsedMs = Math.round(performance.now() - started);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const statusCounts = countBy(results, (r) => String(r.status ?? r.errorName ?? 'unknown'));
  const ok = results.filter((r) => r.ok).length;
  return {
    concurrency,
    total,
    elapsedMs,
    ok,
    failed: total - ok,
    errorRate: round((total - ok) / total, 3),
    timeoutCount: results.filter((r) => r.errorName === 'AbortError').length,
    statusCounts,
    latencyMs: { min: pct(latencies, 0), p50: pct(latencies, 50), p95: pct(latencies, 95), max: pct(latencies, 100) },
    samples: results.slice(0, 5).map((r) => ({ status: r.status, ok: r.ok, latencyMs: r.latencyMs, error: r.error?.slice(0, 160), fields: r.fields })),
  };
}

async function sendOne(index, worker) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeys[index % apiKeys.length]}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Forwarded-For': `198.18.${worker}.${(index % 250) + 1}`,
      },
      body: JSON.stringify({
        model,
        prompt: `Load test cinematic product still ${Date.now()}-${index}: one simple ceramic cup on a plain table, no text, no watermark.`,
        n: 1,
        size,
        quality,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const first = json?.data?.[0];
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Math.round(performance.now() - started),
      fields: first && typeof first === 'object' ? Object.keys(first) : null,
      error: res.ok ? undefined : (json?.error?.message ?? text),
    };
  } catch (error) {
    return { ok: false, errorName: error?.name ?? 'Error', latencyMs: Math.round(performance.now() - started), error: error?.message ?? String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function pct(values, p) {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil((p / 100) * values.length) - 1));
  return values[index];
}
function countBy(items, fn) {
  const out = {};
  for (const item of items) out[fn(item)] = (out[fn(item)] ?? 0) + 1;
  return out;
}
function round(v, n) { return Number(v.toFixed(n)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
