import type { CustomWidget } from "@statly/contract";
import { backgroundStyle } from "@statly/widget-runtime";
import type { ReactNode } from "react";
import { useMedia } from "./useCustomWidgets.ts";

/** The surface of a custom widget. Its size lets elements scale in container units. */
export function WidgetFrame({
  widget,
  children,
}: {
  widget: Pick<CustomWidget, "background">;
  children: ReactNode;
}) {
  const { background } = widget;
  const media = background.kind === "media" ? background : null;
  const url = useMedia(media?.asset.id);
  const video = media?.asset.type.startsWith("video/");
  return (
    <section
      className="relative h-full w-full overflow-hidden rounded-card border border-line shadow-card [container-type:size]"
      style={backgroundStyle(background, url)}
    >
      {media && video && url ? (
        <>
          <video
            src={url}
            autoPlay
            loop={media.loop ?? true}
            muted
            playsInline
            className="absolute inset-0 h-full w-full"
            style={{ objectFit: media.fit }}
          />
          <div
            className="absolute inset-0"
            style={{ background: `rgb(0 0 0 / ${Math.round(media.shade * 100)}%)` }}
          />
        </>
      ) : null}
      {children}
    </section>
  );
}
