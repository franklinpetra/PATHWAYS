import { beforeAll, describe, expect, it } from "vitest";
import { hashAccessCode } from "@/lib/auth/access-code";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

beforeAll(() => {
  process.env.ACCESS_CODE_SECRET = "a".repeat(64);
  process.env.SESSION_SECRET = "b".repeat(64);
});

describe("access codes", () => {
  it("hashes deterministically so codes can be looked up", () => {
    expect(hashAccessCode("AB12CD34")).toBe(hashAccessCode("AB12CD34"));
  });

  it("ignores case and whitespace", () => {
    expect(hashAccessCode(" ab12 cd34 ")).toBe(hashAccessCode("AB12CD34"));
  });

  it("depends on the secret", () => {
    const before = hashAccessCode("AB12CD34");
    process.env.ACCESS_CODE_SECRET = "c".repeat(64);
    expect(hashAccessCode("AB12CD34")).not.toBe(before);
    process.env.ACCESS_CODE_SECRET = "a".repeat(64);
  });
});

describe("sessions", () => {
  it("round-trips a user id", () => {
    expect(verifySessionToken(createSessionToken("user-1"))).toBe("user-1");
  });

  it("rejects tampered and expired tokens", () => {
    const token = createSessionToken("user-1");
    expect(verifySessionToken(token.replace("user-1", "user-2"))).toBeNull();
    expect(verifySessionToken(token, Date.now() + 1000 * 60 * 60 * 24 * 31)).toBeNull();
  });
});
