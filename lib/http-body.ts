/** Ограниченное чтение JSON без доверия Content-Length. Тело хранится только в памяти. */
export type JsonResult = { ok: true; value: Record<string, unknown> } | { ok: false; status: 400 | 413 | 415; error: string };
export async function readJsonObject(req: Request, limit = 16_384): Promise<JsonResult> {
  const type = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (type !== 'application/json') return { ok: false, status: 415, error: 'json_required' };
  const length = req.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return { ok: false, status: 413, error: 'body_too_large' };
  if (!req.body) return { ok: false, status: 400, error: 'invalid_json' };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { void reader.cancel().catch(() => {}); return { ok: false, status: 413, error: 'body_too_large' }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, status: 400, error: 'json_object_required' };
    return { ok: true, value: data as Record<string, unknown> };
  } catch { return { ok: false, status: 400, error: 'invalid_json' }; }
  finally { reader.releaseLock(); }
}
