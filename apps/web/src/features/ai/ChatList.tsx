import { useTranslation } from "@statly/i18n";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { useAiCall, useChats } from "./useAi.ts";

export function ChatList({ onOpened }: { onOpened: () => void }) {
  const { t, i18n } = useTranslation();
  const chats = useChats();
  const open = useAiCall("ai.openChat");
  const remove = useAiCall("ai.deleteChat");
  const start = useAiCall("ai.reset");
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 statly-scroll">
      <Button
        primary
        className="h-8 justify-center"
        onClick={() => {
          start.mutate({});
          onOpened();
        }}
      >
        <Plus size={14} />
        {t("ai.newChat")}
      </Button>
      {chats.data?.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{t("ai.chats.empty")}</p>
      ) : null}
      {chats.data?.map((chat) => (
        <article
          key={chat.id}
          data-chat={chat.id}
          className="group flex items-center gap-1 rounded-control border border-line bg-card pr-1 hover:border-accent"
        >
          <button
            type="button"
            onClick={() => {
              open.mutate({ id: chat.id });
              onOpened();
            }}
            className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent px-3 py-2 text-left text-text"
          >
            <span className="block truncate text-[13px] font-semibold">{chat.title}</span>
            <span className="block text-[11px] text-muted">
              {date.format(new Date(chat.updatedAt))}
            </span>
          </button>
          <button
            type="button"
            aria-label={t("ai.chats.delete", { title: chat.title })}
            title={t("ai.chats.delete", { title: chat.title })}
            onClick={() => remove.mutate({ id: chat.id })}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover hover:text-danger"
          >
            <Trash2 size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}
