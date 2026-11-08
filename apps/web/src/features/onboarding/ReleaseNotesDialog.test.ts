import { describe, expect, it } from "vitest";
import { releasesBetween } from "./ReleaseNotesDialog.tsx";

const releases = { "2.2": ["two two"], "2.10": ["two ten"], "3.0": ["three"], "2.3": [] };

describe("releasesBetween", () => {
  it("lists every big version after the last one shown, newest first", () => {
    expect(releasesBetween("2.1.1", "3.0.2", releases)).toEqual([
      { version: "3.0", notes: ["three"] },
      { version: "2.10", notes: ["two ten"] },
      { version: "2.2", notes: ["two two"] },
    ]);
  });

  it("shows nothing after a small update or without notes", () => {
    expect(releasesBetween("2.2.0", "2.2.4", releases)).toEqual([]);
    expect(releasesBetween("2.2.0", "2.3.0", releases)).toEqual([]);
  });

  it("leaves out notes written ahead for a version not installed yet", () => {
    expect(releasesBetween("2.1.1", "2.2.0", releases)).toEqual([
      { version: "2.2", notes: ["two two"] },
    ]);
  });
});
