import { describe, expect, it } from "vitest";
import { formatNumber } from "@/lib/text/format";

describe("formatNumber", () => {
  it("uses one fixed locale whatever the runtime default is", () => {
    expect(formatNumber(1240)).toBe("1,240");
    expect(formatNumber(200000)).toBe("200,000");
    expect(formatNumber(0)).toBe("0");
  });
  it("rounds to the requested number of decimals", () => {
    expect(formatNumber(12.345, 1)).toBe("12.3");
    expect(formatNumber(1234.5, 1)).toBe("1,234.5");
    expect(formatNumber(7.6)).toBe("8");
  });
});
