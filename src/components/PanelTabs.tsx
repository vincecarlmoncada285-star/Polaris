"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { readLocal, writeLocal } from "@/lib/local-storage";

export interface PanelTab<Id extends string> {
  id: Id;
  label: string;
  panel: ReactNode;
}

/** The browser's remembered tab, if it is one of `ids`. Storage can be blocked: then null. */
function readStored<Id extends string>(key: string, ids: readonly Id[]): Id | null {
  const value = readLocal(key);
  return ids.find((id) => id === value) ?? null;
}

/**
 * The selected tab, remembered per browser. The first render uses `initial` (the server has no
 * storage, and the two renders must match); the stored choice is applied right after.
 * Returns the tab, `select` (the writer's choice: remembered) and `show` (a switch the app
 * makes for them, such as showing a suggestion they clicked in the text: not remembered). Both
 * functions keep their identity, so callbacks created once (editor extensions) can use them.
 */
export function useRememberedTab<Id extends string>(
  key: string,
  ids: readonly Id[],
  initial: Id,
): [Id, (id: Id) => void, (id: Id) => void] {
  const [selected, setSelected] = useState<Id>(initial);
  const idsRef = useRef(ids);
  useEffect(() => {
    const stored = readStored(key, idsRef.current);
    if (stored) setSelected(stored);
  }, [key]);
  const select = useCallback(
    (id: Id) => {
      setSelected(id);
      writeLocal(key, id);
    },
    [key],
  );
  const show = useCallback((id: Id) => setSelected(id), []);
  return [selected, select, show];
}

/**
 * Tabs in the WAI-ARIA pattern: a tablist of tabs with a roving tabindex (only the selected tab
 * is in the Tab order), Left/Right (wrapping), Home and End move between tabs and select them,
 * and each tab controls a tabpanel labelled by it. Every panel stays mounted, so a panel keeps
 * its state while another is shown.
 */
export function PanelTabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
  idPrefix,
}: {
  label: string;
  tabs: PanelTab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  idPrefix: string;
}) {
  const refs = useRef(new Map<Id, HTMLButtonElement>());
  const tabId = (id: Id) => `${idPrefix}-tab-${id}`;
  const panelId = (id: Id) => `${idPrefix}-panel-${id}`;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const id = tabs[next]!.id;
    onSelect(id);
    refs.current.get(id)?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-border">
        {tabs.map((tab, index) => {
          const active = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={active}
              aria-controls={panelId(tab.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-medium sm:flex-none sm:px-3 ${
                active
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          hidden={tab.id !== selected}
          tabIndex={0}
          className="mt-3 min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-accent [&:not([hidden])]:flex"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
