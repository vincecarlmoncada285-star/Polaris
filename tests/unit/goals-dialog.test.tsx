// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GoalsDialog } from "@/components/GoalsDialog";

beforeAll(() => {
  // jsdom has <dialog> but not its modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("GoalsDialog: target length", () => {
  it("is named by its label alone, and described by its hint", () => {
    render(<GoalsDialog open goals={{ targetWords: 2000 }} onClose={vi.fn()} onSave={vi.fn()} />);
    const field = screen.getByRole("spinbutton", { name: "Target length (words)" });
    expect(field).toHaveProperty("value", "2000");
    expect(
      screen.getByRole("spinbutton", {
        description:
          "Optional. A whole number from 50 to 200,000; the Overview shows your progress towards it.",
      }),
    ).toBe(field);
  });
});
