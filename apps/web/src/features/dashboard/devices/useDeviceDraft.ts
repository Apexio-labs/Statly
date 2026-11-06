import {
  type DashboardLayout,
  type DeviceKind,
  type DeviceLayouts,
  type DeviceWidget,
  defaultDevicePeriod,
} from "@statly/contract";
import { useState } from "react";
import { bridge } from "../../../bridge/index.ts";

export type Device = "desktop" | DeviceKind;

/** Everything an edit session changes. It reaches Python only with Save. */
export type Draft = DeviceLayouts & {
  desktop: DashboardLayout;
  /** What each device shows right now, worked out by Python when switching to it. */
  shown: Record<DeviceKind, DeviceWidget[]>;
};

function desktopIds(draft: Draft): string[] {
  return draft.desktop.widgets.map((widget) => widget.id);
}

export function devicesOf(draft: Draft): DeviceLayouts {
  return { tablet: draft.tablet, phone: draft.phone };
}

export function withDeviceWidgets(
  draft: Draft,
  device: DeviceKind,
  widgets: DeviceWidget[],
): Draft {
  return {
    ...draft,
    [device]: { widgets, known: desktopIds(draft) },
    shown: { ...draft.shown, [device]: widgets },
  };
}

/** A new widget on a device starts with the same time range it would get automatically. */
export function deviceWidgetFrom(widget: Omit<DeviceWidget, "period">): DeviceWidget {
  return { ...widget, period: defaultDevicePeriod(widget.type) };
}

export function useDeviceDraft() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");

  async function refreshed(current: Draft): Promise<Draft> {
    const devices = devicesOf(current);
    const resolved = await bridge.call("dashboard.devices", { layout: current.desktop, devices });
    const known = desktopIds(current);
    const update = (name: DeviceKind) =>
      current[name] && { widgets: resolved[name].widgets, known };
    return {
      ...current,
      tablet: update("tablet"),
      phone: update("phone"),
      shown: { tablet: resolved.tablet.widgets, phone: resolved.phone.widgets },
    };
  }

  /** Editing starts at once. The arranged devices follow as soon as Python has answered. */
  async function begin(desktop: DashboardLayout, start: Device = "desktop") {
    const opened: Draft = {
      desktop,
      tablet: null,
      phone: null,
      shown: { tablet: [], phone: [] },
    };
    setDraft(opened);
    const stored = await bridge.call("dashboard.storedDevices", {});
    setSaved(JSON.stringify({ desktop, ...stored }));
    if (start === "desktop") {
      setDraft((current) => current && { ...current, ...stored });
      return;
    }
    setDraft(await refreshed({ ...opened, ...stored }));
    setDevice(start);
  }

  async function switchTo(next: Device) {
    if (draft && next !== "desktop") {
      setDraft(await refreshed(draft));
    }
    setDevice(next);
  }

  async function followDesktop(name: DeviceKind) {
    if (draft) {
      setDraft(await refreshed({ ...draft, [name]: null }));
    }
  }

  /** Puts the default back on every device. Like any other change, it waits for Save. */
  async function resetTo(desktop: DashboardLayout) {
    if (draft) {
      setDraft(await refreshed({ ...draft, desktop, tablet: null, phone: null }));
    }
  }

  function close() {
    setDraft(null);
    setSaved(null);
    setDevice("desktop");
  }

  const dirty = draft !== null && JSON.stringify(devicesAndDesktop(draft)) !== saved;

  return { draft, setDraft, device, begin, switchTo, followDesktop, resetTo, close, dirty };
}

function devicesAndDesktop(draft: Draft) {
  return { desktop: draft.desktop, ...devicesOf(draft) };
}
