// Collecting a file shared from the Android share sheet.
//
// The share arrives as a POST that public/sw.js answers, so by the time the page
// loads the file is sitting in the worker's memory and nowhere else — media
// still never touches disk (ARCHITECTURE.md §5.6). This asks the worker for it
// over a MessagePort.
//
// Pure apart from MessageChannel, which Node has too. Tested in test/share.test.ts.

/** The part of a ServiceWorker this needs — and all a test has to fake. */
export type SharedFileSource = Pick<ServiceWorker, 'postMessage'>;

/**
 * The shared files the worker holds, or [] when there is no worker, it holds
 * nothing, or it does not answer within `timeoutMs`. A worker terminated
 * between the share and this load has nothing to reply with, and would
 * otherwise leave the page waiting on an answer that never comes.
 */
export function collectShared(
  worker: SharedFileSource | null | undefined,
  timeoutMs = 3000,
): Promise<File[]> {
  if (!worker) return Promise.resolve([]);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (files: File[]): void => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(files);
    };
    const timer = setTimeout(() => done([]), timeoutMs);
    channel.port1.onmessage = (e: MessageEvent<File[] | undefined>) => done(e.data ?? []);
    worker.postMessage('take-shared', [channel.port2]);
  });
}
