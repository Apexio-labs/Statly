import {
  type AiProvider,
  type AiStatus,
  aiErrorCodes,
  aiKeyPages,
  aiProviderDefaults,
  aiProviders,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { Select } from "../../components/Select.tsx";
import { UnlockForm } from "./KeyLock.tsx";
import { useAiSetting } from "./useAi.ts";

const FIELD =
  "h-9 w-full min-w-0 rounded-control border border-line bg-control px-3 text-[13px] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const SECTION = "flex flex-col gap-1.5";
const LABEL = "m-0 text-xs font-semibold text-muted";

function KeyHelp({ provider }: { provider: AiProvider | null }) {
  const { t } = useTranslation();
  const page = provider ? aiKeyPages[provider] : undefined;
  if (!page) {
    return null;
  }
  return (
    <details className="text-[11px] text-muted">
      <summary className="cursor-pointer font-semibold">{t("ai.setup.keyHelp")}</summary>
      <ol className="m-0 mt-1 flex list-decimal flex-col gap-0.5 pl-4">
        <li>
          <button
            type="button"
            onClick={() => void bridge.call("system.openExternal", { url: page })}
            className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-semibold text-accent-strong"
          >
            {t("ai.setup.keyHelpOpen")}
          </button>
        </li>
        <li>{t("ai.setup.keyHelpCreate")}</li>
        <li>{t("ai.setup.keyHelpPaste")}</li>
      </ol>
      <p className="m-0 mt-1">{t("ai.setup.keyHelpNote")}</p>
      <p className="m-0 mt-1">{t("ai.setup.keyLimitNote")}</p>
    </details>
  );
}

function KeySection({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const save = useAiSetting("ai.setKey");
  const remove = useAiSetting("ai.removeKey");
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState("");
  const stored = status.hasKey && !replacing;

  if (status.keyLock === "locked") {
    return (
      <section className={SECTION}>
        <h3 className={LABEL}>{t("ai.setup.key")}</h3>
        <p className="m-0 text-xs text-muted">{t("ai.keyLock.lockedNote")}</p>
        <UnlockForm />
      </section>
    );
  }

  return (
    <section className={SECTION}>
      <h3 className={LABEL}>{t("ai.setup.key")}</h3>
      {stored ? (
        <>
          <p className="m-0 flex items-center gap-1.5 text-[13px]">
            <ShieldCheck size={15} className="shrink-0 text-accent" />
            {t(
              status.keyLock === "unlocked"
                ? "ai.setup.keySavedPassword"
                : status.keyStorage === "system"
                  ? "ai.setup.keySaved"
                  : "ai.setup.keySession",
            )}
          </p>
          <div className="flex gap-2">
            <Button className="h-8" onClick={() => setReplacing(true)}>
              {t("ai.setup.keyReplace")}
            </Button>
            <Button className="h-8 text-danger" onClick={() => remove.mutate({})}>
              {t("ai.setup.keyRemove")}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(
              { key: value },
              {
                onSettled: () => setValue(""),
                onSuccess: () => setReplacing(false),
              },
            );
          }}
        >
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={t("ai.setup.key")}
            placeholder={t("ai.setup.keyPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
          />
          <Button primary className="h-9 shrink-0" type="submit" disabled={!value.trim()}>
            <KeyRound size={14} />
            {t("ai.setup.keySave")}
          </Button>
        </form>
      )}
      <p className="m-0 text-[11px] text-muted">
        {t(status.keyStorage === "system" ? "ai.setup.keyNote" : "ai.setup.keyNoteSession")}
      </p>
      {stored ? null : <KeyHelp provider={status.provider} />}
      {save.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {save.error.message}
        </p>
      ) : null}
    </section>
  );
}

function modelError(message: string, known: string): string {
  return (aiErrorCodes as readonly string[]).includes(message) ? message : known;
}

function ModelSection({ status, onModel }: { status: AiStatus; onModel: (model: string) => void }) {
  const { t } = useTranslation();
  const [model, setModel] = useState(status.model);
  const list = useMutation({ mutationFn: () => bridge.call("ai.models", {}) });
  const models = list.data?.models ?? [];
  const chosen = models.find((item) => item.id === model);

  useEffect(() => setModel(status.model), [status.model]);

  return (
    <section className={SECTION}>
      <h3 className={LABEL}>{t("ai.setup.model")}</h3>
      {models.length > 0 ? (
        <Select
          label={t("ai.setup.model")}
          value={model || (models[0]?.id ?? "")}
          options={models.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(next) => {
            setModel(next);
            onModel(next);
          }}
        />
      ) : (
        <input
          value={model}
          aria-label={t("ai.setup.model")}
          placeholder={t("ai.setup.modelPlaceholder")}
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => model !== status.model && onModel(model)}
          spellCheck={false}
          className={FIELD}
        />
      )}
      <Button className="h-8 self-start" disabled={list.isPending} onClick={() => list.mutate()}>
        {t("ai.setup.loadModels")}
      </Button>
      {list.isSuccess ? (
        <p role="status" className="m-0 text-xs text-muted">
          {t("ai.setup.connected", { count: models.length })}
        </p>
      ) : null}
      {chosen?.tools === false ? (
        <p className="m-0 text-xs text-danger">{t("ai.setup.noTools")}</p>
      ) : null}
      {list.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {t(`ai.errors.${modelError(list.error.message, "bad_response") as "unreachable"}`)}
        </p>
      ) : null}
    </section>
  );
}

function Consent({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const consent = useAiSetting("ai.consent");
  if (status.consented) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2 rounded-control border border-line bg-card p-3">
      <h3 className="m-0 text-[13px] font-bold">{t("ai.consent.title")}</h3>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
        <li>{t("ai.consent.sent")}</li>
        <li>{t("ai.consent.names")}</li>
        <li>{t("ai.consent.never")}</li>
        <li>{t("ai.consent.terms")}</li>
      </ul>
      <Button primary className="h-8 self-start" onClick={() => consent.mutate({})}>
        {t("ai.consent.accept")}
      </Button>
    </section>
  );
}

export function SetupView({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const configure = useAiSetting("ai.configure");
  const provider = status.provider;
  const defaults = provider ? aiProviderDefaults[provider] : null;
  const [address, setAddress] = useState(status.baseUrl);

  useEffect(() => setAddress(status.baseUrl), [status.baseUrl]);

  function choose(next: AiProvider) {
    configure.mutate({
      provider: next,
      model: "",
      baseUrl: "",
    });
  }

  function change(patch: { model?: string; baseUrl?: string }) {
    if (provider) {
      configure.mutate({
        provider,
        model: status.model,
        baseUrl: status.baseUrl,
        ...patch,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={SECTION}>
        <h3 className={LABEL}>{t("ai.setup.provider")}</h3>
        <div role="radiogroup" aria-label={t("ai.setup.provider")} className="grid gap-1.5">
          {aiProviders.map((name) => (
            // biome-ignore lint/a11y/useSemanticElements: the whole card is the choice.
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={provider === name}
              onClick={() => choose(name)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-control border px-3 py-2 text-left ${
                provider === name
                  ? "border-accent bg-selected"
                  : "border-line bg-control hover:bg-hover"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-text">
                  {t(`ai.providers.${name}.name`)}
                </span>
                <span className="block text-[11px] text-muted">
                  {t(`ai.providers.${name}.note`)}
                </span>
              </span>
              {aiProviderDefaults[name].local ? (
                <span className="shrink-0 rounded-full bg-success-surface px-2 py-0.5 text-[10px] font-semibold text-success">
                  {t("ai.setup.local")}
                </span>
              ) : null}
              {aiProviderDefaults[name].beta ? (
                <span
                  title={t("ai.setup.betaNote")}
                  className="shrink-0 rounded-full bg-selected px-2 py-0.5 text-[10px] font-semibold text-accent-strong"
                >
                  {t("ai.setup.beta")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>
      {provider === "custom" || defaults?.local ? (
        <section className={SECTION}>
          <h3 className={LABEL}>{t("ai.setup.address")}</h3>
          <input
            value={address}
            aria-label={t("ai.setup.address")}
            onChange={(event) => setAddress(event.target.value)}
            onBlur={() => address !== status.baseUrl && change({ baseUrl: address })}
            spellCheck={false}
            placeholder="https://"
            className={FIELD}
          />
          {defaults?.local ? (
            <p className="m-0 text-[11px] text-muted">{t(`ai.providers.${provider}.help`)}</p>
          ) : null}
        </section>
      ) : null}
      {configure.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {configure.error.message}
        </p>
      ) : null}
      {defaults?.needsKey || provider === "custom" ? <KeySection status={status} /> : null}
      {provider ? <ModelSection status={status} onModel={(model) => change({ model })} /> : null}
      {provider ? <Consent status={status} /> : null}
    </div>
  );
}
