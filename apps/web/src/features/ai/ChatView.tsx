import type { AiErrorCode, AiMessage, AiProposal, AiWaiting } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, RotateCcw, ShieldQuestion, Square, Star } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { spotlight } from "../../lib/spotlight.ts";
import { ANKIWEB_RATE_URL } from "../onboarding/RatingDialog.tsx";
import { type Choice, trailingChoices } from "./choices.ts";
import { Markdown } from "./Markdown.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { useAiCall, useConversation } from "./useAi.ts";

const TYPE_MS = 45;
const HOLD_MS = 1500;

const SETUP_ERRORS: readonly AiErrorCode[] = [
  "not_configured",
  "key_missing",
  "keys_locked",
  "key_invalid",
  "consent_needed",
  "bad_url",
  "model_missing",
];

/** Some local models write their reasoning into the answer. It is not meant to be read. */
export function withoutReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
}

function ToolLine({ tools }: { tools: string[] }) {
  const { t } = useTranslation();
  const reads = tools.filter((tool) => !tool.startsWith("propose_")).length;
  return reads > 0 ? (
    <p className="m-0 text-[11px] text-muted">{t("ai.toolsUsed", { count: reads })}</p>
  ) : null;
}

function shuffled(words: string[]): string[] {
  const mixed = [...words];
  for (let index = mixed.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [mixed[index], mixed[other]] = [mixed[other] as string, mixed[index] as string];
  }
  return mixed;
}

/**
 * Words being typed make a wait feel shorter than one that stands still. They say nothing about
 * the task on purpose, because the same wait can mean counting reviews or reading a card.
 */
function WorkingLine() {
  const { t } = useTranslation();
  const words = useMemo(() => shuffled(t("ai.working").split("|")), [t]);
  const calm = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [turn, setTurn] = useState(0);
  const [typed, setTyped] = useState(0);
  const word = `${words[turn % words.length] ?? ""}…`;
  const finished = calm || typed >= word.length;

  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (finished) {
          setTurn(turn + 1);
          setTyped(0);
        } else {
          setTyped(typed + 1);
        }
      },
      finished ? HOLD_MS : TYPE_MS,
    );
    return () => clearTimeout(timer);
  }, [finished, turn, typed]);

  return (
    <p className="m-0 text-[13px] text-muted">
      <span role="status" className="sr-only">
        {t("ai.workingLabel")}
      </span>
      <span data-testid="working-word" aria-hidden="true" className="statly-typing">
        {finished ? word : word.slice(0, typed)}
      </span>
    </p>
  );
}

function Message({
  message,
  proposals,
  writing,
}: {
  message: AiMessage;
  proposals: AiProposal[];
  writing: boolean;
}) {
  const { t } = useTranslation();
  const own = proposals.filter((proposal) => message.proposals.includes(proposal.id));
  const shown = withoutReasoning(message.text);
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="m-0 max-w-[85%] rounded-[12px] bg-selected px-3 py-2 text-[13px] whitespace-pre-wrap text-text [overflow-wrap:anywhere]">
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <div data-testid="ai-answer" className="flex flex-col gap-2">
      {shown ? <Markdown text={shown} /> : null}
      {writing && !shown ? <WorkingLine /> : null}
      <ToolLine tools={message.tools} />
      {own.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
      {message.notice ? (
        <p className="m-0 text-xs text-muted">{t(`ai.notices.${message.notice}`)}</p>
      ) : null}
    </div>
  );
}

/**
 * The chat's own buttons only ever allow this chat. "Always allow" is a switch in the settings,
 * and the button leads there and frames it. Switching it on lets the waiting chat go on.
 */
function PermissionRequest({ waiting }: { waiting: Extract<AiWaiting, { kind: "permission" }> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const answer = useAiCall("ai.answerPermission");
  return (
    <section
      role="alertdialog"
      aria-label={t(`ai.permission.${waiting.scope}.title`)}
      className="flex flex-col gap-2 rounded-control border border-accent bg-card p-3"
    >
      <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-bold">
        <ShieldQuestion size={15} className="shrink-0 text-accent" />
        {t(`ai.permission.${waiting.scope}.title`)}
      </h3>
      <p className="m-0 text-xs text-muted">{t(`ai.permission.${waiting.scope}.body`)}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button primary className="h-8" onClick={() => answer.mutate({ decision: "once" })}>
          {t("ai.permission.once")}
        </Button>
        <Button
          className="h-8"
          onClick={() => {
            void navigate("/settings/ai");
            spotlight(`ai-permission-${waiting.scope}`);
          }}
        >
          {t("ai.permission.always")}
        </Button>
        <Button className="h-8" onClick={() => answer.mutate({ decision: "deny" })}>
          {t("ai.permission.deny")}
        </Button>
      </div>
      <p className="m-0 text-[11px] text-muted">{t("ai.permission.alwaysNote")}</p>
    </section>
  );
}

function Options({ options, onPick }: { options: Choice[]; onPick: (label: string) => void }) {
  return (
    <>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={() => onPick(option.label)}
          className="cursor-pointer rounded-control border border-line bg-card px-3 py-2 text-left text-[13px] font-medium text-text hover:border-accent hover:bg-hover"
        >
          {option.label}
          {option.description ? (
            <span className="block text-[11px] font-normal text-muted">{option.description}</span>
          ) : null}
        </button>
      ))}
    </>
  );
}

function Question({ waiting }: { waiting: Extract<AiWaiting, { kind: "question" }> }) {
  const answer = useAiCall("ai.answerQuestion");
  return (
    <section className="flex flex-col gap-1.5">
      <p className="m-0 text-[13px] font-semibold [overflow-wrap:anywhere]">{waiting.question}</p>
      <Options options={waiting.options} onPick={(label) => answer.mutate({ text: label })} />
    </section>
  );
}

/** Nobody here can test the cloud services, so a report that one works is worth a lot. */
function ReviewRequest() {
  const { t } = useTranslation();
  const answered = useMutation({ mutationFn: () => bridge.call("ai.reviewAnswered", {}) });
  if (answered.isSuccess) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2 rounded-control border border-line bg-card p-3">
      <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-bold">
        <Star size={15} className="shrink-0 text-accent" />
        {t("ai.review.title")}
      </h3>
      <p className="m-0 text-xs text-muted">{t("ai.review.body")}</p>
      <div className="flex gap-1.5">
        <Button
          primary
          className="h-8"
          onClick={() => {
            void bridge.call("system.openExternal", { url: ANKIWEB_RATE_URL });
            answered.mutate();
          }}
        >
          {t("ai.review.rate")}
        </Button>
        <Button className="h-8" onClick={() => answered.mutate()}>
          {t("ai.review.later")}
        </Button>
      </div>
    </section>
  );
}

/** Suggested widgets open by themselves once, so people see how they are built. */
const openedProposals = new Set<string>();

export function ChatView({ onOpenSetup }: { onOpenSetup: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { messages, proposals, running, waiting, askReview, error, title } = useConversation();
  const send = useAiCall("ai.send");
  const stop = useAiCall("ai.stop");
  const reset = useAiCall("ai.reset");
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const placed = new Set(messages.flatMap((message) => message.proposals));
  const unplaced = proposals.filter(
    (proposal) => proposal.status === "pending" && !placed.has(proposal.id),
  );
  const last = messages.at(-1);
  const lastText = last?.text.length ?? 0;
  const offered = last?.role === "assistant" ? trailingChoices(withoutReasoning(last.text)) : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: new text is what moves the view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length, lastText, proposals.length, waiting]);

  useEffect(() => {
    const widget = proposals.find(
      (proposal) =>
        proposal.kind === "widget" &&
        proposal.status === "pending" &&
        proposal.source === "chat" &&
        !openedProposals.has(proposal.id),
    );
    if (widget) {
      openedProposals.add(widget.id);
      void navigate(`/library/widgets/new?proposal=${widget.id}`);
    }
  }, [proposals, navigate]);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed && (!running || waiting?.kind === "question")) {
      send.mutate({ text: trimmed });
      setText("");
    }
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(text);
    }
  }

  return (
    <>
      {title ? (
        <p className="m-0 truncate border-b border-line px-3 py-1.5 text-xs font-semibold text-muted">
          {title}
        </p>
      ) : null}
      <div
        ref={list}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 statly-scroll"
      >
        {unplaced.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} />
        ))}
        {messages.length === 0 ? (
          <div className="mt-auto flex flex-col gap-2">
            <p className="m-0 text-[13px] text-muted">{t("ai.intro")}</p>
            {(["example1", "example2", "example3"] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => submit(t(`ai.${name}`))}
                className="cursor-pointer rounded-control border border-line bg-control px-3 py-2 text-left text-xs font-medium text-text hover:bg-hover"
              >
                {t(`ai.${name}`)}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            proposals={proposals}
            writing={running && !waiting && index === messages.length - 1}
          />
        ))}
        {waiting?.kind === "permission" ? <PermissionRequest waiting={waiting} /> : null}
        {waiting?.kind === "question" ? <Question waiting={waiting} /> : null}
        {running || waiting ? null : (
          <section className="flex flex-col gap-1.5">
            <Options options={offered} onPick={submit} />
          </section>
        )}
        {askReview ? <ReviewRequest /> : null}
        {error ? (
          <div role="alert" className="rounded-control border border-line p-3 text-[13px]">
            <p className="m-0 text-danger">{t(`ai.errors.${error.code}`)}</p>
            {error.detail ? <p className="m-0 mt-1 text-xs text-muted">{error.detail}</p> : null}
            {SETUP_ERRORS.includes(error.code) ? (
              <button
                type="button"
                onClick={onOpenSetup}
                className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent-strong"
              >
                {t("ai.openSetup")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="flex flex-col gap-1.5 border-t border-line p-2.5">
        <div className="flex items-end gap-2 rounded-control border border-line bg-control p-1.5 focus-within:ring-2 focus-within:ring-accent/40">
          <textarea
            value={text}
            rows={2}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKey}
            placeholder={t("ai.placeholder")}
            aria-label={t("ai.placeholder")}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-1 text-[13px] text-text outline-none placeholder:text-muted"
          />
          {running && waiting?.kind !== "question" ? (
            <button
              type="button"
              aria-label={t("ai.stop")}
              title={t("ai.stop")}
              onClick={() => stop.mutate({})}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-hover text-text"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("ai.send")}
              title={t("ai.send")}
              disabled={!text.trim()}
              onClick={() => submit(text)}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-primary text-on-primary disabled:cursor-default disabled:opacity-40"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={() => reset.mutate({})}
            className="flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-[11px] font-medium text-muted hover:text-text"
          >
            <RotateCcw size={11} />
            {t("ai.newChat")}
          </button>
        ) : null}
      </footer>
    </>
  );
}
