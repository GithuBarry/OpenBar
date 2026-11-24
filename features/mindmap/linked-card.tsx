"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CornerDownRight } from "lucide-react";
import { sameMapCardId } from "./card-link-history";
import { RichText } from "@/components/rich-text";
import type { CardNavigationItem } from "./child-navigation";
import previewStyles from "./child-navigation.module.css";
import richStyles from "@/components/rich-text.module.css";

export type LinkedCardPreviewItem = CardNavigationItem & {
  /** False when one or more collapsed ancestors currently hide this card on the map. */
  visible?: boolean;
  /** Number of currently hidden cards that will expand if the user jumps to this card. */
  expandCardCount?: number;
  /** Number of collapsed ancestor branches that will open on jump. */
  expandBranchCount?: number;
  archived?: boolean;
};

type LinkPreview = { sourceId: string; targetId: string; trigger: HTMLAnchorElement };
type LinkNavigation = {
  currentUrl: URL | null;
  lookup: (id: string) => LinkedCardPreviewItem | undefined;
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

export function CardMentionLink({ id, label, raw }: { id: string; label?: string; raw: string }) {
  const href = `#${encodeURIComponent(id)}`;
  const destination = useLinkedCard(href);
  if (!destination) return <>{raw}</>;
  const hidden = destination.visible === false;
  return (
    <CardDestinationLink
      href={href}
      className={richStyles.cardMention}
      dataHidden={hidden}
    >
      <CornerDownRight className={richStyles.cardMentionIcon} size={11} aria-hidden="true" />
      <span>{label?.trim() || destination.title || "Untitled card"}</span>
    </CardDestinationLink>
  );
}

export function CardDestinationLink({ href, children, className = "", sourceId, title, externalIcon, dataHidden }: {
  href: string; children: ReactNode; className?: string; sourceId?: string; title?: string; externalIcon?: ReactNode; dataHidden?: boolean;
}) {
  const navigation = useContext(Navigation);
  const destination = useLinkedCard(href);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  const preview = navigation?.preview;
  const id = destination?.id;
  const isVisible = destination?.visible !== false;
  useEffect(() => {
    const anchor = trigger.current;
    if (!open || !id || !isVisible || !anchor || !preview) return;
    preview(anchor, sourceId, id, true);
    return () => preview(anchor, sourceId, id, false);
  }, [id, isVisible, open, preview, sourceId]);

  const rawUrlText = Boolean(destination && typeof children === "string" && children.trim() === href.trim());
  const content = rawUrlText
    ? <><CornerDownRight className={richStyles.cardMentionIcon} size={11} aria-hidden="true" /><span>{destination!.title || "Linked card"}</span></>
    : children;
  const resolvedClass = rawUrlText ? `${richStyles.cardMention} nodrag nopan` : `${className} nodrag nopan`;
  const hiddenAttr = (dataHidden ?? (destination ? !isVisible : false)) || undefined;

  const anchor = <a ref={trigger} href={href} className={resolvedClass}
    data-map-card-link={id} data-map-card-source={id ? sourceId : undefined} data-card-hidden={hiddenAttr}
    target={id ? undefined : "_blank"} rel={id ? undefined : "noopener noreferrer"}
    title={id ? undefined : title} onClick={event => { event.stopPropagation(); setOpen(false); }}
    onDoubleClick={event => event.stopPropagation()}>
    {content}{!id && externalIcon}
  </a>;
  if (!destination) return anchor;

  const expandCards = destination.expandCardCount ?? 0;
  const expandBranches = destination.expandBranchCount ?? 0;
  const hint = !isVisible
    ? expandCards > 0
      ? `Hidden on map · click to expand ${expandCards} ${expandCards === 1 ? "card" : "cards"}${expandBranches > 1 ? ` (${expandBranches} branches)` : ""} and jump`
      : "Hidden on map · click to expand and jump"
    : "Click to jump";

  return <Tooltip.Root open={open} onOpenChange={setOpen} delayDuration={100}>
    <Tooltip.Trigger asChild>{anchor}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className={previewStyles.previewWrap} side="top" sideOffset={8} collisionPadding={12}>
      <div className={previewStyles.preview}>
        <Navigation.Provider value={null}>
          {destination.archived && <span className={previewStyles.archiveBadge}>Archive</span>}
          <strong><RichText text={destination.title || "Untitled card"} format={destination.format === "html" ? "plain" : destination.format} /></strong>
          {destination.body.trim() && <div className={previewStyles.body}><RichText text={destination.body} format={destination.format} /></div>}
        </Navigation.Provider>
      </div>
      <span className={previewStyles.hint} data-card-preview-hint={isVisible ? "visible" : "hidden"}>{hint}</span>
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>;
}
