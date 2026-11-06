const LASTING_MS = 8000;
const ATTEMPTS = 30;
const RETRY_MS = 100;

/**
 * Frames a setting for a few seconds, so someone who was sent there learns where it lives.
 * The page may still be loading after a navigation, so this waits for the element a little.
 */
export function spotlight(name: string, attempts = ATTEMPTS): void {
  const target = document.querySelector<HTMLElement>(`[data-highlight="${name}"]`);
  if (!target) {
    if (attempts > 0) {
      setTimeout(() => spotlight(name, attempts - 1), RETRY_MS);
    }
    return;
  }
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.add("statly-spotlight");
  const end = () => target.classList.remove("statly-spotlight");
  target.addEventListener("pointerdown", end, { once: true });
  setTimeout(end, LASTING_MS);
}
