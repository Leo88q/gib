/** Per-process defence in depth, not a production/distributed rate limiter. */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
let calls = 0;

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  if (++calls % 200 === 0 || buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && buckets.size >= MAX_BUCKETS) return false;
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Proxy headers are attacker-controlled unless a trusted ingress strips them.
 * Authenticated callers use the verified parent; unauthenticated routes share a bucket. */
export function clientKey(_req: Request, scope: string, verifiedParent?: string): string {
  return `${scope}:${verifiedParent ? `parent:${verifiedParent}` : 'anonymous'}`;
}
