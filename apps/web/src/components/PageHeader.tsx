import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 bg-page p-4 pb-3">
      <div className="flex min-h-[58px] items-center gap-2 rounded-card bg-card px-5 py-2 shadow-card">
        <span className="text-[13px] font-bold text-accent">Statly</span>
        <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-line" />
        <h1 className="m-0 min-w-0 flex-1 truncate text-[15px] font-bold text-text">{title}</h1>
        {children}
      </div>
    </header>
  );
}
