import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** Time between steps while held. */
const REPEAT_MS = 120;

/**
 * Repeats `onStep` while pressed (pointer or Space/Enter). A step is skipped while the
 * previous one is still being sent, so a slow Bluetooth link can't build up a backlog
 * of paper moves that keep running after release.
 */
export function HoldButton({
  onStep,
  disabled,
  className,
  children,
}: {
  onStep: () => Promise<unknown>;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pending = useRef(false);
  const stepRef = useRef(onStep);

  useEffect(() => {
    stepRef.current = onStep;
  });

  const step = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    void stepRef.current().finally(() => {
      pending.current = false;
    });
  }, []);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const start = () => {
    if (disabled || timer.current) return;
    step();
    timer.current = setInterval(step, REPEAT_MS);
  };

  // Never keep moving paper if the release is missed: disabled mid-hold, window switch, unmount.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);
  useEffect(() => {
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [stop]);

  const isActivationKey = (key: string) => key === " " || key === "Enter";

  return (
    <button
      type="button"
      className={className ? `${className} hold` : "hold"}
      title="hold to move paper"
      disabled={disabled}
      onPointerDown={(e) => e.button === 0 && start()}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (!isActivationKey(e.key)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => isActivationKey(e.key) && stop()}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}
