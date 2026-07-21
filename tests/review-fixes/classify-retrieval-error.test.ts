import { describe, expect, it } from "vitest";
import { classifyRetrievalError } from "../../src/instrumentation.js";

describe("classifyRetrievalError fetch failures", () => {
  it("classifies an undici fetch failure with an ECONNREFUSED cause as a connection error", () => {
    const cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:1"),
      {
        code: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
        address: "127.0.0.1",
        port: 1,
      },
    );
    const error = new TypeError("fetch failed", { cause });

    expect(classifyRetrievalError(error)).toBe("connection_error");
  });

  it("classifies a browser Failed to fetch error as a connection error", () => {
    expect(classifyRetrievalError(new TypeError("Failed to fetch"))).toBe(
      "connection_error",
    );
  });

  it("[passing invariant] keeps an existing timeout classification unchanged", () => {
    expect(classifyRetrievalError(new Error("ETIMEDOUT"))).toBe(
      "connection_error",
    );
  });
});
