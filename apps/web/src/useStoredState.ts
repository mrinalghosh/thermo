import { useEffect, useState } from "react";

/** useState persisted to localStorage. New keys in `initial` survive older stored values. */
export function useStoredState<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`thermo:${key}`);
      return stored === null ? initial : { ...initial, ...JSON.parse(stored) };
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(`thermo:${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
