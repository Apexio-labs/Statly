import { type AiStatus, aiKeyPasswordMin } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { SwitchRow } from "./SwitchRow.tsx";
import { useAiSetting } from "./useAi.ts";

const FIELD =
  "h-9 w-full min-w-0 rounded-control border border-line bg-control px-3 text-[13px] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="password"
      value={value}
      aria-label={label}
      placeholder={label}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      className={FIELD}
    />
  );
}

function LockError({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="m-0 text-xs text-danger">
      {error.message === "wrong_password" ? t("ai.keyLock.wrongPassword") : error.message}
    </p>
  );
}

function ForgotPassword() {
  const { t } = useTranslation();
  const forget = useAiSetting("ai.forgetKeys");
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] font-semibold text-muted"
      >
        {t("ai.keyLock.forgot")}
      </button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-label={t("ai.keyLock.forgot")}
      className="flex flex-col gap-2 rounded-control border border-danger p-3"
    >
      <p className="m-0 text-xs text-muted">{t("ai.keyLock.forgotNote")}</p>
      <div className="flex gap-2">
        <Button className="h-8 text-danger" onClick={() => forget.mutate({})}>
          {t("ai.keyLock.forgotConfirm")}
        </Button>
        <Button className="h-8" onClick={() => setAsking(false)}>
          {t("dashboard.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function UnlockForm() {
  const { t } = useTranslation();
  const unlock = useAiSetting("ai.unlockKeys");
  const [password, setPassword] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          unlock.mutate({ password }, { onSettled: () => setPassword("") });
        }}
      >
        <PasswordField label={t("ai.keyLock.password")} value={password} onChange={setPassword} />
        <Button
          primary
          className="h-9 shrink-0"
          type="submit"
          disabled={!password || unlock.isPending}
        >
          <LockOpen size={14} />
          {t("ai.keyLock.unlock")}
        </Button>
      </form>
      <LockError error={unlock.error} />
      <ForgotPassword />
    </div>
  );
}

/** Stands in for the chat, because nothing can be sent before the key is open. */
export function LockedChat() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-y-auto p-4 statly-scroll">
      <Lock size={22} className="text-accent" />
      <h3 className="m-0 text-[15px] font-bold">{t("ai.keyLock.lockedTitle")}</h3>
      <p className="m-0 text-xs text-muted">{t("ai.keyLock.lockedNote")}</p>
      <UnlockForm />
    </div>
  );
}

function NewPassword({
  value,
  repeated,
  onChange,
  onRepeat,
}: {
  value: string;
  repeated: string;
  onChange: (value: string) => void;
  onRepeat: (value: string) => void;
}) {
  const { t } = useTranslation();
  const tooShort = value.length > 0 && value.length < aiKeyPasswordMin;
  const different = repeated.length > 0 && repeated !== value;
  return (
    <>
      <PasswordField label={t("ai.keyLock.new")} value={value} onChange={onChange} />
      <PasswordField label={t("ai.keyLock.repeat")} value={repeated} onChange={onRepeat} />
      {tooShort ? (
        <p className="m-0 text-xs text-danger">
          {t("ai.keyLock.tooShort", { count: aiKeyPasswordMin })}
        </p>
      ) : null}
      {different ? <p className="m-0 text-xs text-danger">{t("ai.keyLock.mismatch")}</p> : null}
    </>
  );
}

type Step = "enable" | "disable" | "change";

function PasswordStep({ step, onDone }: { step: Step; onDone: () => void }) {
  const { t } = useTranslation();
  const enable = useAiSetting("ai.enableKeyLock");
  const disable = useAiSetting("ai.disableKeyLock");
  const change = useAiSetting("ai.changeKeyPassword");
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const [repeated, setRepeated] = useState("");
  const pending = enable.isPending || disable.isPending || change.isPending;
  const asksCurrent = step !== "enable";
  const asksFresh = step !== "disable";
  const ready =
    (!asksCurrent || current.length > 0) &&
    (!asksFresh || (fresh.length >= aiKeyPasswordMin && fresh === repeated));

  function submit() {
    const after = { onSuccess: onDone, onSettled: () => setCurrent("") };
    if (step === "enable") {
      enable.mutate({ password: fresh }, after);
    } else if (step === "disable") {
      disable.mutate({ password: current }, after);
    } else {
      change.mutate({ current, password: fresh }, after);
    }
  }

  return (
    <form
      aria-label={t(`ai.keyLock.steps.${step}`)}
      className="flex flex-col gap-2 rounded-control border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="m-0 text-xs text-muted">{t(`ai.keyLock.notes.${step}`)}</p>
      {asksCurrent ? (
        <PasswordField label={t("ai.keyLock.current")} value={current} onChange={setCurrent} />
      ) : null}
      {asksFresh ? (
        <NewPassword value={fresh} repeated={repeated} onChange={setFresh} onRepeat={setRepeated} />
      ) : null}
      <LockError error={enable.error ?? disable.error ?? change.error} />
      <div className="flex gap-2">
        <Button primary className="h-8" type="submit" disabled={!ready || pending}>
          {t(`ai.keyLock.steps.${step}`)}
        </Button>
        <Button className="h-8" onClick={onDone}>
          {t("dashboard.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function KeyLockSection({ status }: { status: AiStatus }) {
  const { t } = useTranslation();
  const lock = useAiSetting("ai.lockKeys");
  const [step, setStep] = useState<Step | null>(null);
  const state = status.keyLock;

  if (state === "unavailable") {
    return (
      <section>
        <h4 className="m-0 text-[13px] font-semibold">{t("ai.keyLock.title")}</h4>
        <p className="m-0 text-[11px] text-muted">{t("ai.keyLock.unavailable")}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <SwitchRow
        title={t("ai.keyLock.title")}
        note={t("ai.keyLock.note")}
        checked={state !== "off"}
        onChange={(next) => setStep(next ? "enable" : "disable")}
      />
      <p className="m-0 text-[11px] text-muted">{t("ai.keyLock.limit")}</p>
      {state === "unlocked" && !step ? (
        <div className="flex flex-wrap gap-2">
          <Button className="h-8" onClick={() => lock.mutate({})}>
            <Lock size={14} />
            {t("ai.keyLock.lockNow")}
          </Button>
          <Button className="h-8" onClick={() => setStep("change")}>
            {t("ai.keyLock.steps.change")}
          </Button>
        </div>
      ) : null}
      {step ? <PasswordStep step={step} onDone={() => setStep(null)} /> : null}
    </section>
  );
}
