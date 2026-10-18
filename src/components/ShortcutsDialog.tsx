"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  detectPlatform,
  shortcutKeys,
  shortcutLabel,
  type Platform,
} from "@/lib/shortcuts";

/** Every keyboard shortcut, grouped, with the modifier names of the writer's own computer. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Only ever shown in the browser, so reading navigator here cannot upset hydration.
  const [platform, setPlatform] = useState<Platform>("other");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setPlatform(detectPlatform(navigator));
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="shortcuts-heading"
      aria-describedby="shortcuts-platform"
      className="m-auto max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="shortcuts-heading" className="text-lg font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="rounded-md px-3 py-1 text-sm text-muted hover:bg-background hover:text-foreground"
          >
            Close
          </button>
        </div>
        <p id="shortcuts-platform" className="text-sm text-muted">
          {platform === "mac"
            ? "Shown for a Mac. On Windows and Linux, use Ctrl for Cmd and Alt for Option."
            : "Shown for Windows and Linux. On a Mac, use Cmd for Ctrl and Option for Alt."}
        </p>
        {SHORTCUT_GROUPS.map((group) => (
          <table key={group} className="w-full text-left text-sm">
            <caption className="mb-1 text-left font-semibold">{group}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Keys</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <tr key={s.action}>
                  <td className="py-1.5 pr-4">{s.action}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {s.keys.map((combo, i) => (
                      <Fragment key={combo}>
                        {i > 0 && <span className="px-1 text-muted">or</span>}
                        <kbd title={shortcutLabel(combo, platform)}>
                          {shortcutKeys(combo, platform).map((key, k) => (
                            <Fragment key={k}>
                              {k > 0 && <span className="px-0.5 text-muted">+</span>}
                              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans text-xs">
                                {key}
                              </kbd>
                            </Fragment>
                          ))}
                        </kbd>
                      </Fragment>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </dialog>
  );
}
