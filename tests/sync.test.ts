import { describe, expect, it } from "vitest";
import { guardPartial } from "@/lib/data/washington/sync";

describe("guardPartial", () => {
  it("allows a first load and a normal refresh", () => {
    expect(() => guardPartial("apprenticeships", 496, 0)).not.toThrow();
    expect(() => guardPartial("apprenticeships", 480, 496)).not.toThrow();
  });

  it("refuses an empty download", () => {
    expect(() => guardPartial("apprenticeships", 0, 0)).toThrow(/leaving the table unchanged/);
  });

  it("refuses a download under half of what is already loaded, so a bad day never empties a table", () => {
    expect(() => guardPartial("apprenticeships", 200, 496)).toThrow(/looks partial, so nothing was written/);
  });
});
