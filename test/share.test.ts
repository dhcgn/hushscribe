import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectShared, type SharedFileSource } from '../src/share';

/** A worker that answers `take-shared` on the port it is handed — or not. */
function fakeWorker(reply: (port: MessagePort) => void): SharedFileSource {
  return {
    postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      expect(message).toBe('take-shared');
      const port = Array.isArray(transfer) ? transfer[0] : undefined;
      if (!(port instanceof MessagePort)) throw new Error('no port transferred');
      reply(port);
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('collectShared', () => {
  it('resolves to nothing when the page is not controlled by a worker', async () => {
    expect(await collectShared(null)).toEqual([]);
    expect(await collectShared(undefined)).toEqual([]);
  });

  it('hands back the files the worker was holding', async () => {
    // A plain object, not a File: Node 22 structured-clones a File into a nameless
    // Blob, Node 24 keeps the name. The relay is what is under test, not the clone.
    const shared = [{ name: 'clip.webm' } as File];
    const worker = fakeWorker((port) => { port.postMessage(shared); port.close(); });
    const files = await collectShared(worker);
    expect(files.map((f) => f.name)).toEqual(['clip.webm']);
  });

  it('treats an empty reply as no files', async () => {
    const worker = fakeWorker((port) => { port.postMessage(undefined); port.close(); });
    expect(await collectShared(worker)).toEqual([]);
  });

  it('gives up when a restarted worker never answers, instead of waiting forever', async () => {
    vi.useFakeTimers();
    const worker = fakeWorker((port) => { port.close(); });
    const files = collectShared(worker, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await files).toEqual([]);
  });
});
