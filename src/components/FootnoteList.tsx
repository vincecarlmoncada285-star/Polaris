"use client";

import {
  footnoteEntryId,
  footnoteKey,
  footnoteRefId,
  footnoteTextId,
  type FootnoteInfo,
} from "@/lib/editor/footnote";

export type FootnoteEntry = Pick<FootnoteInfo, "id" | "content" | "number">;

/**
 * The document's footnotes under the article, in order. Each marker in the text is described
 * by its entry's text (aria-describedby) and links to it; each entry links back to its marker
 * and has an edit button. Printed as a plain numbered list.
 */
export function FootnoteList({
  footnotes,
  onEdit,
  onShowMarker,
}: {
  footnotes: FootnoteEntry[];
  onEdit: (footnote: FootnoteEntry) => void;
  /** Selects the marker in the text; false if it is no longer there. */
  onShowMarker: (footnote: FootnoteEntry) => boolean;
}) {
  if (footnotes.length === 0) return null;
  return (
    <section
      aria-labelledby="footnotes-heading"
      className="polaris-footnotes mt-10 border-t border-border pt-6 font-serif"
      data-testid="footnotes"
    >
      <h2 id="footnotes-heading" className="mb-3 text-base font-semibold">
        Footnotes
      </h2>
      <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed">
        {footnotes.map((f) => {
          const key = footnoteKey(f);
          return (
            <li key={key} id={footnoteEntryId(key)} className="pl-1">
              <span id={footnoteTextId(key)}>
                {f.content || <em className="text-muted">(no text yet)</em>}
              </span>{" "}
              <a
                href={`#${footnoteRefId(key)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onShowMarker(f);
                }}
                className="polaris-footnote-back text-accent no-underline hover:underline"
              >
                <span aria-hidden>↩</span>
                <span className="sr-only">Back to footnote {f.number} in the text</span>
              </a>{" "}
              <button
                type="button"
                onClick={() => onEdit(f)}
                aria-label={`Edit footnote ${f.number}`}
                className="polaris-footnote-edit rounded px-1.5 font-sans text-xs text-muted underline hover:text-foreground"
              >
                Edit
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
