export type Choice = { label: string; description?: string | undefined };

const ITEM = /^(?:\d{1,2}[.)]|[a-zA-Z][.)]|[-*•])\s+(.+)$/;
const SPLIT = /\s+[-–—]\s+|:\s+/;
const ASKING = /\?|\b(?:wähle|wählst|aussuchen|entscheide|choose|pick|select)\b/i;
const MIN_CHOICES = 2;
const MAX_CHOICES = 6;
const MAX_LABEL = 80;

function choiceFrom(item: string): Choice {
  const plain = item.replace(/\*\*|`/g, "").trim();
  const [label = plain, ...rest] = plain.split(SPLIT);
  const description = rest.join(": ").trim();
  return description && label.length <= MAX_LABEL ? { label, description } : { label: plain };
}

/**
 * Models do not always use the tool for questions, and some never do. So a question that ends in
 * a short list works like one asked properly. Without a question, a list stays a plain list.
 */
export function trailingChoices(text: string): Choice[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const closing = lines.at(-1)?.match(ITEM) ? undefined : lines.pop();
  const items: string[] = [];
  for (let line = lines.pop(); line; line = lines.pop()) {
    const item = line.match(ITEM)?.[1];
    if (!item) {
      lines.push(line);
      break;
    }
    items.unshift(item);
  }
  const asked = ASKING.test(`${lines.at(-1) ?? ""} ${closing ?? ""}`);
  const choices = items.map(choiceFrom);
  const fits =
    choices.length >= MIN_CHOICES &&
    choices.length <= MAX_CHOICES &&
    choices.every((choice) => choice.label.length <= MAX_LABEL);
  return asked && fits ? choices : [];
}
