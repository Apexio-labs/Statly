import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean };

export function Button({ primary = false, className = "", ...props }: Props) {
  const look = primary
    ? "border-transparent bg-primary text-on-primary hover:bg-primary-hover"
    : "border-line bg-control text-text hover:bg-hover";
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-control border px-3 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-50 ${look} ${className}`}
    />
  );
}
