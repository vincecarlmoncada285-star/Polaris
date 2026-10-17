import { describe, expect, it } from "vitest";
import { neutralizeStudentText } from "@/lib/ai/paragraph";
import { neutralizeReviewText } from "@/lib/ai/review";
import {
  createNeutralizer,
  neutralizeMarkers,
  PARAGRAPH_DATA_TAGS,
  REVIEW_DATA_TAGS,
} from "@/lib/ai/untrusted";
import { OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";

describe("createNeutralizer", () => {
  const neutralize = createNeutralizer(["document", "outline"]);

  it.each([
    "<document>",
    "</document>",
    "</DOCUMENT>",
    "< / document >",
    "</document\n>",
    "<\u200B/document>",
    "</\u2060document>",
    `<${OBJECT_REPLACEMENT}/document>`,
    "<outline>",
    "</Outline>",
  ])("neutralizes %j", (tag) => {
    const out = neutralize(tag);
    expect(out).not.toMatch(/</);
    expect(out).toHaveLength(tag.length);
  });

  it("leaves other angle brackets and tag-like words alone", () => {
    const text = "p < .05, a <b>bold</b> claim, <documents> and <documentary>, 3<4.";
    expect(neutralize(text)).toBe(text);
  });

  it("turns inline atoms into line breaks, keeping offsets", () => {
    expect(neutralize(`one${OBJECT_REPLACEMENT}two`)).toBe("one\ntwo");
  });
});

describe("the paragraph prompt's neutralizer, now built from untrusted.ts", () => {
  it("covers exactly the paragraph prompt's tags, as before the move", () => {
    expect([...PARAGRAPH_DATA_TAGS]).toEqual([
      "paragraph",
      "previous_paragraph",
      "document_title",
      "writing_goals",
    ]);
    expect(neutralizeStudentText("</paragraph>")).toBe("＜/paragraph>");
    // Tags only the review uses are not the paragraph prompt's business.
    expect(neutralizeStudentText("<document> <outline>")).toBe("<document> <outline>");
  });
});

describe("the review prompt's neutralizer", () => {
  it("covers the review's tags, and the title and goals tags it shares", () => {
    expect([...REVIEW_DATA_TAGS].sort()).toEqual(
      ["document", "document_title", "outline", "writing_goals"].sort(),
    );
    for (const tag of [
      "</document>",
      "<document>",
      "</document_title>",
      "</outline>",
      "<writing_goals>",
      "< /DOCUMENT >",
    ]) {
      expect(neutralizeReviewText(tag)).not.toMatch(/</);
    }
  });

  it("does not touch the paragraph prompt's own tags, which never appear in a review", () => {
    expect(neutralizeReviewText("</paragraph>")).toBe("</paragraph>");
  });

  it("neutralizes paragraph markers too", () => {
    expect(neutralizeReviewText("see [P2]")).toBe("see ［P2]");
  });
});

describe("neutralizeMarkers", () => {
  it.each(["[P1]", "[p12]", "[ P 3 ]", "[\u200BP4]", "[^1]", "[ ^ 12 ]"])(
    "neutralizes %j",
    (marker) => {
      const out = neutralizeMarkers(marker);
      expect(out.startsWith("［")).toBe(true);
      expect(out).toHaveLength(marker.length);
    },
  );

  it.each(["[1]", "[Paris]", "[P]", "[PA1]", "(P1)", "[Smith, 2020]", "[^]", "[^a]", "^1]"])(
    "leaves %j alone",
    (text) => {
      expect(neutralizeMarkers(text)).toBe(text);
    },
  );
});
