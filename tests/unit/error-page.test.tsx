// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The root fallback imports the global stylesheet (Tailwind's PostCSS plugin is Next's job).
vi.mock("@/app/globals.css", () => ({}));

import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const serverError = () =>
  Object.assign(
    new Error("PrismaClientKnownRequestError: SELECT * FROM Document at /app/x.ts:12"),
    {
      digest: "2803453812",
      stack: "Error: secret\n    at loadDocument (/app/src/app/documents/[id]/load.ts:9:3)",
    },
  );

describe("the error page", () => {
  it("apologises, offers Try again (calling reset) and a way home", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<ErrorPage error={serverError()} reset={reset} />);
    expect(screen.getByRole("heading", { name: "This page couldn’t be shown" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Back to your documents" }).getAttribute("href")).toBe(
      "/",
    );
  });

  it("never shows the error's message or stack, only its reference", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<ErrorPage error={serverError()} reset={() => {}} />);
    const text = container.textContent!;
    expect(text).not.toContain("Prisma");
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("load.ts");
    expect(text).not.toContain("secret");
    expect(screen.getByTestId("error-reference").textContent).toBe("Reference: 2803453812");
    // The console gets the reference too, not the message.
    expect(console.error).toHaveBeenCalledWith("Polaris page error, reference 2803453812");
  });

  it("has no reference line for an error without a digest (one in the browser)", () => {
    render(<ErrorPage error={new Error("x is undefined")} reset={() => {}} />);
    expect(screen.queryByTestId("error-reference")).toBeNull();
    expect(document.body.textContent).not.toContain("x is undefined");
  });

  it("the root fallback is a whole document with the same message and the footer", () => {
    const html = renderToString(<GlobalError error={serverError()} reset={() => {}} />);
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("Try again");
    expect(html).toContain("Polaris is open source");
    expect(html).not.toContain("Prisma");
    expect(html).not.toContain("load.ts");
  });
});
