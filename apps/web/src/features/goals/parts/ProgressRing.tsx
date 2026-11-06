import type { ReactNode } from "react";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring that fills with the day's progress. What goes in the middle is up to the caller. */
export function ProgressRing({
  progress,
  color,
  label,
  children,
}: {
  progress: number;
  color: string;
  label: string;
  children?: ReactNode;
}) {
  const share = Math.max(0, Math.min(1, progress));
  return (
    <div className="relative grid h-full w-full place-items-center [container-type:size]">
      <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={label}>
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="var(--statly-hover)"
          strokeWidth="9"
        />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="rotate(-90 50 50)"
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
      ) : null}
    </div>
  );
}
