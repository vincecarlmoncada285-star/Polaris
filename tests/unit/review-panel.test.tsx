// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  relativeTime,
  retryWhen,
  REVIEW_RUNNING,
  REVIEW_SENDS,
  REVIEW_STALE,
  ReviewPanel,
  reviewErrorFor,
  type ReviewAvailability,
} from "@/components/ReviewPanel";
import { AI_EXPLANATION } from "@/components/settings/AiToggle";
import type { DocumentReviewDTO } from "@/lib/ai/protocol";

const ON: ReviewAvailability = { enabled: true, configured: true };
const TEXT = "Draft text.";

function review(overrides: Partial<DocumentReviewDTO> = {}): DocumentReviewDTO {
  return {
    id: "rev_1",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    model: "claude-opus-5-5",
    wordCount: 1240,
    stale: false,
    result: {
      summary: "The essay argues that homework helps.",
      thesis: { assessment: "Clear but overstated.", quote: "Homework helps every student" },
      strengths: ["A clear structure."],
      priorities: [
        {
          title: "Narrow the claim",
          detail: "Nine students are not every student.",
          quote: "nine students",
          category: "evidence",
        },
        {
          title: "Add a counterargument",
          detail: "Consider the other side.",
          quote: null,
          category: "argument",
        },
      ],
      sections: [{ paragraph: 2, heading: "Evidence", note: "Say how they were chosen." }],
      structure: "Logical order.",
      argument: "Overstated.",
      evidence: "Thin.",
      style: "Suitable.",
    },
    ...overrides,
  };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
const none = () => json({ error: "No review yet.", code: "none" }, { status: 404 });

let fetchMock: ReturnType<typeof vi.fn>;

function renderPanel(props: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
  const callbacks = {
    flushSave: vi.fn(async () => true),
    onFindQuote: vi.fn<(quote: string) => boolean>(() => true),
    onFindParagraph: vi.fn<(n: number) => boolean>(() => true),
  };
  const make = (more: Partial<Parameters<typeof ReviewPanel>[0]> = {}) => (
    <ReviewPanel
      documentId="doc_1"
      active
      ai={ON}
      words={400}
      text={TEXT}
      layout="0"
      {...callbacks}
      {...props}
      {...more}
    />
  );
  const utils = render(make());
  return {
    ...utils,
    ...callbacks,
    rerenderWith: (more: Partial<Parameters<typeof ReviewPanel>[0]>) => utils.rerender(make(more)),
  };
}

beforeEach(() => {
  fetchMock = vi.fn(async () => none());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("review panel: before any review", () => {
  it("loads the latest review when shown, after saving, and says exactly what a review sends", async () => {
    const { flushSave } = renderPanel();
    await screen.findByRole("button", { name: "Review document" });
    expect(flushSave).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc_1/review", { cache: "no-store" });
    expect(screen.getByText(new RegExp(`^${REVIEW_SENDS}`))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review document" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("loads nothing while hidden", async () => {
    renderPanel({ active: false });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<Parameters<typeof ReviewPanel>[0]>, RegExp]>([
    [
      "AI is off",
      { ai: { enabled: false, configured: true } },
      /AI is off\. Turn it on in Settings/,
    ],
    [
      "the server has no key",
      { ai: { enabled: true, configured: false } },
      /aren’t set up on this server/,
    ],
    ["the document is short", { words: 149 }, /needs at least 150 words\. This document has 149/],
    [
      "the document is too long",
      { words: 60_001 },
      /up to 60,000 words\. This document has 60,001/,
    ],
  ])("disables the button with a visible reason when %s", async (_label, props, reason) => {
    renderPanel(props);
    const button = await screen.findByRole("button", { name: "Review document" });
    expect(button).toHaveProperty("disabled", true);
    const why = screen.getByTestId("review-blocked");
    expect(why.textContent).toMatch(reason);
    expect(button.getAttribute("aria-describedby")).toBe(why.id);
  });

  it("says when Polaris could not find out whether AI is on, instead of checking forever", async () => {
    const { rerenderWith } = renderPanel({ ai: null });
    const button = await screen.findByRole("button", { name: "Review document" });
    expect(screen.getByTestId("review-blocked").textContent).toBe(
      "Checking whether reviews are available…",
    );
    rerenderWith({ ai: null, aiLookupFailed: true });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByTestId("review-blocked").textContent).toBe(
      "Polaris couldn’t check whether reviews are available. Reload the page to try again.",
    );
  });

  it("links to Settings when AI is off", async () => {
    renderPanel({ ai: { enabled: false, configured: true } });
    const link = await screen.findByRole("link", { name: "Settings" });
    expect(link.getAttribute("href")).toBe("/settings");
  });
});

describe("review panel: running a review", () => {
  it("announces the run, offers Cancel, and shows the results", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Promise<Response>((r) => (finish = r)) : none(),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Review document" }));
    const status = screen.getByRole("status");
    await waitFor(() => expect(status.textContent).toBe(REVIEW_RUNNING));
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    await act(async () => finish(json({ review: review() }, { status: 201 })));
    await screen.findByTestId("review-results");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: /^Reviewed 5 minutes ago · 1,240 words$/ }),
    ).toBeTruthy();
    expect(screen.getByText("The essay argues that homework helps.")).toBeTruthy();
    const priorities = screen.getByTestId("review-priorities");
    expect(priorities.querySelectorAll("li")).toHaveLength(2);
    expect(priorities.textContent).toContain("Evidence");
    expect(priorities.textContent).toContain("Argument");
    for (const aspect of ["Structure", "Argument", "Evidence", "Style"]) {
      expect(screen.getByRole("region", { name: aspect })).toBeTruthy();
    }
    expect(screen.queryByTestId("review-stale")).toBeNull();
  });

  it("moves focus to Cancel when a run starts from the keyboard, then to the results", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Promise<Response>((r) => (finish = r)) : none(),
    );
    renderPanel();
    const start = await screen.findByRole("button", { name: "Review document" });
    start.focus();
    fireEvent.click(start);
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await act(async () => finish(json({ review: review() }, { status: 201 })));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: /^Reviewed / })),
    );
  });

  it("moves focus from Review again to Cancel, and back to Review again when cancelled", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return json({ review: review({ stale: true }) });
      return new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      );
    });
    renderPanel();
    const again = await screen.findByRole("button", { name: "Review again" });
    again.focus();
    fireEvent.click(again);
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Review again" })),
    );
  });

  it("cancels by aborting the request, and saves nothing to show", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return none();
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
      );
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Review document" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Review cancelled."));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Review document" })).toBeTruthy();
  });

  it("does not send anything if the latest changes could not be saved", async () => {
    renderPanel({ flushSave: vi.fn(async () => false) });
    fireEvent.click(await screen.findByRole("button", { name: "Review document" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn’t save your latest changes/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each<[string, () => Response | Promise<Response>, RegExp]>([
    [
      "a refusal",
      () => json({ error: "x", code: "refused" }, { status: 422 }),
      /declined to review this document.*not a judgement of your writing/,
    ],
    [
      "the rate limit, with when to try again",
      () =>
        json(
          { error: "You have asked for several reviews recently.", code: "rate_limited" },
          { status: 429, headers: { "content-type": "application/json", "Retry-After": "2400" } },
        ),
      /^You have asked for several reviews recently\. You can ask for a review again in about 40 minutes\.$/,
    ],
    [
      "an unconfigured server",
      () => json({ error: "x", code: "ai_unavailable" }, { status: 503 }),
      /aren’t set up/,
    ],
    [
      "an upstream failure",
      () => json({ error: "x", code: "ai_error" }, { status: 502 }),
      /couldn’t finish the review just now/,
    ],
    [
      "a network failure",
      () => Promise.reject(new TypeError("Failed to fetch")),
      /Couldn’t reach Polaris\. Check your connection/,
    ],
  ])("explains %s", async (_label, respond, message) => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? respond() : none(),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Review document" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
  });
});

describe("review panel: results", () => {
  beforeEach(() => fetchMock.mockImplementation(async () => json({ review: review() })));

  it("finds a quote in the current text, and announces when the passage has changed", async () => {
    const { onFindQuote } = renderPanel();
    const quote = await screen.findByRole("button", { name: "Show in text: “nine students”" });
    fireEvent.click(quote);
    expect(onFindQuote).toHaveBeenCalledWith("nine students");
    expect(screen.queryByText("(this passage has changed)")).toBeNull();
    // A live region next to the button, there before anything is said in it.
    const live = quote.nextElementSibling!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
    onFindQuote.mockReturnValue(false);
    fireEvent.click(quote);
    expect(quote.nextElementSibling).toBe(live);
    expect(live.textContent?.trim()).toBe("(this passage has changed)");
    expect(screen.getByRole("button", { description: "(this passage has changed)" })).toBe(quote);
  });

  it("jumps to a numbered paragraph from a section note, and announces when it has gone", async () => {
    const { onFindParagraph } = renderPanel();
    const button = await screen.findByRole("button", { name: "Go to paragraph 2" });
    fireEvent.click(button);
    expect(onFindParagraph).toHaveBeenCalledWith(2);
    const live = button.nextElementSibling!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    onFindParagraph.mockReturnValue(false);
    fireEvent.click(button);
    expect(live.textContent?.trim()).toBe("(this paragraph has changed)");
  });

  it("offers Review again for a review that is not stale, as goals may have changed", async () => {
    renderPanel();
    await screen.findByTestId("review-results");
    expect(screen.queryByTestId("review-stale")).toBeNull();
    const again = screen.getByRole("button", { name: "Review again" });
    expect(again).toHaveProperty("disabled", false);
    expect(screen.getByTestId("review-again").textContent).toMatch(/writing goals/);
    // Still subject to the same reasons as the first review.
    cleanup();
    renderPanel({ ai: { enabled: false, configured: true } });
    await screen.findByTestId("review-results");
    expect(screen.getByRole("button", { name: "Review again" })).toHaveProperty("disabled", true);
  });

  it("shows the stale banner when the server says the document changed", async () => {
    fetchMock.mockImplementation(async () => json({ review: review({ stale: true }) }));
    renderPanel();
    const banner = await screen.findByTestId("review-stale");
    expect(banner.textContent).toContain(REVIEW_STALE);
    // One Review again, in the banner.
    expect(screen.getByRole("button", { name: "Review again" })).toHaveProperty("disabled", false);
    expect(banner.contains(screen.getByRole("button", { name: "Review again" }))).toBe(true);
    expect(screen.queryByTestId("review-again")).toBeNull();
  });

  it("shows the stale banner as soon as the writer edits after the review", async () => {
    const { rerenderWith } = renderPanel();
    await screen.findByTestId("review-results");
    expect(screen.queryByTestId("review-stale")).toBeNull();
    rerenderWith({ text: `${TEXT} More.` });
    expect(screen.getByTestId("review-stale").textContent).toContain(REVIEW_STALE);
    // Undoing back to the reviewed text: no longer stale.
    rerenderWith({ text: TEXT });
    expect(screen.queryByTestId("review-stale")).toBeNull();
  });

  it("is stale once a paragraph becomes a heading, which renumbers the paragraphs", async () => {
    const { rerenderWith } = renderPanel({ layout: "0,0" });
    await screen.findByTestId("review-results");
    rerenderWith({ layout: "2,0" });
    expect(screen.getByTestId("review-stale").textContent).toContain(REVIEW_STALE);
    rerenderWith({ layout: "0,0" });
    expect(screen.queryByTestId("review-stale")).toBeNull();
  });

  it("is stale once a footnote changes, though the text and headings do not", async () => {
    // footnotesLayout(): [block, offset, text] for each footnote.
    const { rerenderWith } = renderPanel({ footnotes: '[[0,5,"Smith 2020."]]' });
    await screen.findByTestId("review-results");
    expect(screen.queryByTestId("review-stale")).toBeNull();
    rerenderWith({ footnotes: '[[0,5,"Smith 2021."]]' });
    expect(screen.getByTestId("review-stale").textContent).toContain(REVIEW_STALE);
    rerenderWith({ footnotes: '[[0,5,"Smith 2020."]]' });
    expect(screen.queryByTestId("review-stale")).toBeNull();
    rerenderWith({ footnotes: "[]" });
    expect(screen.getByTestId("review-stale").textContent).toContain(REVIEW_STALE);
  });

  it("refreshes the review each time the tab is shown again", async () => {
    const { rerenderWith } = renderPanel();
    await screen.findByTestId("review-results");
    rerenderWith({ active: false });
    fetchMock.mockImplementation(async () => json({ review: review({ stale: true }) }));
    rerenderWith({ active: true });
    await screen.findByTestId("review-stale");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("what a review sends", () => {
  it("is said the same way in the Review tab and in Settings", () => {
    expect(REVIEW_SENDS).toBe(
      "Polaris sends this whole document with its footnotes, its title and your writing goals to Anthropic's Claude API",
    );
    expect(AI_EXPLANATION).toContain(
      "Asking for a review in the Review tab sends the whole document with its footnotes, its title and your writing goals.",
    );
  });
});

describe("review panel helpers", () => {
  const now = new Date(2026, 9, 16, 10, 0).getTime();

  it("says when to try again", () => {
    expect(retryWhen(30, now)).toBe("in a minute");
    expect(retryWhen(2400, now)).toBe("in about 40 minutes");
    const time = (s: number) =>
      new Date(now + s * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(retryWhen(3 * 3600, now)).toBe(`at ${time(3 * 3600)}`);
    expect(retryWhen(20 * 3600, now)).toBe(`tomorrow at ${time(20 * 3600)}`);
  });

  it("formats how long ago a review was made", () => {
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(relativeTime(ago(10_000), now)).toBe("just now");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 hours ago");
    expect(relativeTime(ago(24 * 3_600_000), now)).toBe("yesterday");
  });

  it("falls back to the server's message for length errors and a generic one otherwise", () => {
    expect(reviewErrorFor(422, { error: "Needs 150 words.", code: "too_short" }, NaN).message).toBe(
      "Needs 150 words.",
    );
    expect(reviewErrorFor(401, null, NaN).message).toMatch(/Sign in again/);
    expect(reviewErrorFor(500, null, NaN).message).toMatch(/couldn’t finish/);
    expect(reviewErrorFor(403, { error: "x", code: "ai_disabled" }, NaN).settings).toBe(true);
  });
});
