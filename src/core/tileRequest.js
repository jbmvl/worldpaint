/* Le propriétaire d'une source, son appelant et le délai réseau peuvent tous interrompre une tuile. */
export function tileRequest({ signal, lifetime, timeoutMs }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const signals = [signal, lifetime].filter(Boolean);
  for (const source of signals) {
    if (source.aborted) abort();
    else source.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      for (const source of signals) source.removeEventListener('abort', abort);
    },
  };
}
