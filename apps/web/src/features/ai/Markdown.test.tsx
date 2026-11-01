import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks } from "./Markdown.tsx";

describe("model text", () => {
  it("shows emphasis, lists and tables", () => {
    const { container } = render(
      <Markdown text={"**Bold** and `code`\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("never turns text into HTML", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> <b>hi</b>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeTruthy();
  });

  it("keeps links and images as plain text, so an address cannot carry data away", () => {
    const { container } = render(
      <Markdown text={"![x](https://evil.example/?d=1) [y](https://evil.example)"} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("evil.example");
  });

  it("copes with text that is still being written", () => {
    expect(parseBlocks("```\ncode").at(0)).toEqual({ kind: "code", lines: ["code"] });
    expect(parseBlocks("| A |").at(0)).toEqual({ kind: "text", text: "| A |" });
  });
});
