"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { sameMapCardId } from "./card-link-history";
import { RichText } from "@/components/rich-text";
import type { CardNavigationItem } from "./child-navigation";
import previewStyles from "./child-navigation.module.css";

type LinkPreview = { sourceId: string; targetId: string; trigger: HTMLAnchorElement };
type LinkNavigation = {
  currentUrl: URL | null;
  lookup: (id: string) => CardNavigationItem | undefined;
  preview: (trigger: HTMLAnchorElement, sourceId: string | undefined, targetId: string, open: boolean) => void;
};

const Navigation = createContext<LinkNavigation | null>(null);
export const LinkPreviewContext = createContext<LinkPreview | null>(null);

export function CardLinkNavigation({ mapPath, lookup, children }: {
  mapPath: string; lookup: LinkNavigation["lookup"]; children: ReactNode;
}) {
  const [origin, setOrigin] = useState("");
  const [line, setLine] = useState<LinkPreview | null>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const currentUrl = useMemo(() => origin ? new URL(mapPath, origin) : null, [mapPath, origin]);
  const preview = useCallback<LinkNavigation["preview"]>((trigger, sourceId, targetId, open) => {
    const owner = sourceId || trigger.closest<HTMLElement>("[data-mind-node]")?.dataset.mindNode;
    if (open && owner && owner !== targetId) setLine({ sourceId: owner, targetId, trigger });
    else setLine(current => current?.trigger === trigger ? null : current);
  }, []);
  const navigation = useMemo(() => ({ currentUrl, lookup, preview }), [currentUrl, lookup, preview]);
  return <Navigation.Provider value={navigation}><LinkPreviewContext.Provider value={line}>
    {children}
  </LinkPreviewContext.Provider></Navigation.Provider>;
}

export function useLinkedCard(href: string) {
  const navigation = useContext(Navigation);
  const id = navigation?.currentUrl && sameMapCardId(href, navigation.currentUrl);
  return id ? navigation!.lookup(id) : undefined;
}

export function CardDestinationLink({ href, children, className = "", sourceId, title, externalIcon }: {
  href: string; children: ReactNode; className?: string; sourceId?: string; title?: string; externalIcon?: ReactNode;
}) {
  const navigation = useContext(Navigation);
  const destination = useLinkedCard(href);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  const preview = navigation?.preview;
  const id = destination?.id;
  useEffect(() => {
    const anchor = trigger.current;
    if (!open || !id || !anchor || !preview) return;
    preview(anchor, sourceId, id, true);
    return () => preview(anchor, sourceId, id, false);
  }, [id, open, preview, sourceId]);
  const anchor = <a ref={trigger} href={href} className={`${className} nodrag nopan`}
    data-map-card-link={id} data-map-card-source={id ? sourceId : undefined} target={id ? undefined : "_blank"} rel={id ? undefined : "noopener noreferrer"}
    title={id ? undefined : title} onClick={event => { event.stopPropagation(); setOpen(false); }}
    onDoubleClick={event => event.stopPropagation()}>
    {children}{!id && externalIcon}
  </a>;
  if (!destination) return anchor;
  return <Tooltip.Root open={open} onOpenChange={setOpen} delayDuration={100}>
    <Tooltip.Trigger asChild>{anchor}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className={previewStyles.preview} side="top" sideOffset={8} collisionPadding={12}>
      <Navigation.Provider value={null}>
        <strong><RichText text={destination.title || "Untitled card"} format={destination.format === "html" ? "plain" : destination.format} /></strong>
        {destination.body.trim() && <div className={previewStyles.body}><RichText text={destination.body} format={destination.format} /></div>}
      </Navigation.Provider>
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>;
}
