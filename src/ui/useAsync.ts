// A promise's value in a component (undefined while it is pending; an Error when it failed).
import { useEffect, useState, type DependencyList } from 'react';

export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): T | Error | undefined {
  const [value, setValue] = useState<T | Error | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setValue(undefined);
    load().then(
      (v) => live && setValue(v),
      (err: unknown) => live && setValue(err instanceof Error ? err : new Error(String(err))),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what `load` depends on
  }, deps);
  return value;
}
