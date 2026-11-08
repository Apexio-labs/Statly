import { useTranslation } from "@statly/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";

export interface Release {
  version: string;
  notes: string[];
}

/** The first two numbers of a version, which change with a big update. */
function bigVersion(version: string): [number, number] | null {
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function compare(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** The notes of every big version after ``since`` up to ``current``, newest first. */
export function releasesBetween(
  since: string,
  current: string,
  releases: Record<string, unknown>,
): Release[] {
  const from = bigVersion(since);
  const to = bigVersion(current);
  if (!from || !to) {
    return [];
  }
  return Object.entries(releases)
    .flatMap(([version, notes]) => {
      const big = bigVersion(version);
      const lines = Array.isArray(notes) ? notes.filter((note) => typeof note === "string") : [];
      return big && compare(big, from) > 0 && compare(big, to) <= 0 && lines.length > 0
        ? [{ version, notes: lines, big }]
        : [];
    })
    .sort((a, b) => compare(b.big, a.big))
    .map(({ version, notes }) => ({ version, notes }));
}

/**
 * What came with the updates since Statly last showed its notes. Undefined while Python has not
 * answered, so other popups wait instead of appearing on top.
 */
export function useReleaseNotes(): Release[] | undefined {
  const { t } = useTranslation();
  const pending = useQuery({
    queryKey: ["releaseNotes.pending"],
    queryFn: () => bridge.call("releaseNotes.pending", {}),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (pending.isError) {
    return [];
  }
  if (!pending.data) {
    return undefined;
  }
  const releases: unknown = t("whatsNew.releases", { returnObjects: true });
  return releasesBetween(
    pending.data.since,
    pending.data.current,
    typeof releases === "object" && releases !== null ? (releases as Record<string, unknown>) : {},
  );
}

/** Shown once after a big update. Python remembers the version when it closes. */
export function ReleaseNotesDialog({ releases }: { releases: Release[] }) {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(false);

  const newest = releases[0];
  if (closed || !newest) {
    return null;
  }

  function close() {
    void bridge.call("releaseNotes.seen", {});
    setClosed(true);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("whatsNew.title", { version: newest.version })}
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-popover bg-card p-6 text-text shadow-card statly-scroll"
      >
        <h2 className="m-0 text-lg font-bold">
          {t("whatsNew.title", { version: newest.version })}
        </h2>
        {releases.map((release, index) => (
          <section key={release.version} className="flex flex-col gap-2">
            {index > 0 ? (
              <h3 className="m-0 text-sm font-semibold text-muted">
                {t("whatsNew.version", { version: release.version })}
              </h3>
            ) : null}
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-muted">
              {release.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ))}
        <Button primary className="justify-center" onClick={close}>
          {t("whatsNew.close")}
        </Button>
      </div>
    </div>
  );
}
