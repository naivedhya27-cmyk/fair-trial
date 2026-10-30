// Downloads for the face finder's files (S21): a try that receives nothing for `stallMs` is aborted and the file is
// fetched again, up to `tries` tries, 1 s then 2 s apart. `onBytes` hears every chunk as it arrives, and the bytes of a
// try that fails are taken back with a negative count, so a progress figure never runs ahead of what is kept.

export const STALL_MS = 10_000;
export const TRIES = 3;

export interface DownloadOptions {
  stallMs?: number;
  tries?: number;
  /** wait between tries, in ms for the try that just failed (1-based); 1 s, then 2 s by default */
  backoff?: (t: number) => number;
  fetchImpl?: typeof fetch;
}

export async function download(url: string, onBytes: (n: number) => void = () => {}, opts: DownloadOptions = {}): Promise<Uint8Array> {
  const stallMs = opts.stallMs ?? STALL_MS;
  const tries = opts.tries ?? TRIES;
  const backoff = opts.backoff ?? ((t: number) => 1000 * t);
  const get = opts.fetchImpl ?? fetch;
  let last: unknown = null;
  for (let t = 1; t <= tries; t++) {
    const ac = new AbortController();
    let timer = setTimeout(() => ac.abort(), stallMs);
    const fresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), stallMs);
    };
    let got = 0;
    try {
      const res = await get(url, { signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
      fresh();
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.byteLength;
        onBytes(value.byteLength);
        fresh();
      }
      clearTimeout(timer);
      const out = new Uint8Array(got);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.byteLength;
      }
      return out;
    } catch (e) {
      clearTimeout(timer);
      if (got) onBytes(-got);
      last = e;
      if (t < tries) await new Promise((r) => setTimeout(r, backoff(t)));
    }
  }
  throw last instanceof Error ? last : new Error(`${url} did not load`);
}

/** `download`, kept in Cache Storage under `cacheName`: a file found there needs no network. Without Cache Storage (an
 * old browser, a blocked or full store) it falls back to the network and the browser's own cache. */
export async function cachedDownload(cacheName: string, url: string, type: string, onBytes: (n: number) => void = () => {}, opts: DownloadOptions = {}): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) {
      const b = new Uint8Array(await hit.arrayBuffer());
      onBytes(b.byteLength);
      return b;
    }
  } catch {
    cache = null;
  }
  const b = await download(url, onBytes, opts);
  try {
    await cache?.put(url, new Response(new Blob([b as Uint8Array<ArrayBuffer>], { type }), { headers: { "Content-Type": type } }));
  } catch {
    /* not kept: the next load comes from the network again */
  }
  return b;
}

/** Remove the copies kept under older names (an older MediaPipe or model). */
export async function pruneCaches(prefix: string, keep: string): Promise<void> {
  try {
    for (const k of await caches.keys()) if (k.startsWith(prefix) && k !== keep) await caches.delete(k);
  } catch {
    /* no Cache Storage: nothing to prune */
  }
}
