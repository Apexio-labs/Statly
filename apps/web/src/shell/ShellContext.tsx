import { createContext, useContext, useEffect } from "react";

export type RailKind = "settings" | "widgets";

export type ShellContextValue = {
  /** Where the side panel of the current page is drawn. */
  railHost: HTMLElement | null;
  setRail: (kind: RailKind | null) => void;
  openAi: () => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const shell = useContext(ShellContext);
  if (!shell) {
    throw new Error("useShell needs the Shell.");
  }
  return shell;
}

/** Opens the side panel while `kind` is set. Returns the element to portal its content into. */
export function useRail(kind: RailKind | null): HTMLElement | null {
  const { setRail, railHost } = useShell();
  useEffect(() => {
    setRail(kind);
    return () => setRail(null);
  }, [kind, setRail]);
  return railHost;
}
