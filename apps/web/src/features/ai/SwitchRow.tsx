import { Toggle } from "../settings/parts.tsx";

export function SwitchRow({
  title,
  note,
  checked,
  onChange,
}: {
  title: string;
  note: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="m-0 text-[13px] font-semibold">{title}</h4>
        <p className="m-0 text-[11px] text-muted">{note}</p>
      </div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}
