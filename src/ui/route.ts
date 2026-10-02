// Hash routing shared by the shells: #/page/arg.
import { useSyncExternalStore } from 'react';

const subscribeHash = (f: () => void): (() => void) => {
  window.addEventListener('hashchange', f);
  return () => window.removeEventListener('hashchange', f);
};

/** The page named by the hash (`fallback` when it is not one of `pages`), its argument, and the hash itself. */
export function useHashRoute<P extends string>(pages: readonly P[], fallback: P): { page: P; arg: string | undefined; hash: string } {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  const [p, arg] = hash.replace(/^#\/?/, '').split('/');
  const page = pages.includes(p as P) ? (p as P) : fallback;
  return { page, arg, hash };
}
