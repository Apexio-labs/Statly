import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
  icon?: ReactNode;
};

export function Select<T extends string>({ value, options, onChange, label, icon }: Props<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <RadixSelect.Trigger
        aria-label={label}
        className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-control border border-line bg-control px-3 text-[13px] font-semibold text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {icon}
        <span className="max-w-52 truncate">
          <RadixSelect.Value />
        </span>
        <RadixSelect.Icon className="ml-auto text-muted">
          <ChevronDown size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-80 overflow-hidden rounded-popover border border-line bg-card shadow-card"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-[13px] text-text outline-none data-[highlighted]:bg-hover"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto text-accent">
                  <Check size={14} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
