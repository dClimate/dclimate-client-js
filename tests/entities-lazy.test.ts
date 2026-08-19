import { describe, expect, it, vi } from "vitest";
import type { TableField } from "@dclimate/tabular/reader";
import { DClimateClient } from "../src/index.js";
import { EntitiesClient } from "../src/entities/entities-client.js";
import { DatasetNotFoundError } from "../src/errors.js";

/**
 * The reader stack (tabular -> hyparquet -> compressors) must not load with the
 * client. `client.entities` constructing lazily saves nothing if a static
 * import chain evaluated the modules anyway -- which is exactly what happened
 * when `entities-client.ts` imported the reader at the top: every consumer of
 * the main entry paid the bundle and startup cost of entity support, browsers
 * included, whether or not they ever touched it.
 *
 * The mock factory below runs only when the mocked module is first evaluated,
 * which makes it a tripwire for exactly that regression. This file must not
 * import anything from `@dclimate/tabular/reader` at the top level itself
 * (types are fine -- they are erased), or the tripwire fires on the test's own
 * import graph rather than the client's.
 */
const state = vi.hoisted(() => ({ evaluated: false }));

vi.mock("@dclimate/tabular/reader", async (importOriginal) => {
  state.evaluated = true;
  return importOriginal();
});

const REAL_CID =
  "bafyr4ieoihgvnl5rvu6eh2fqduapjtz7wjp3e7kdtfxjospmavi5lgkoq4";

describe("entity reader lazy loading", () => {
  it("loads tabular's reader on first load(), not with the client", async () => {
    const client = new DClimateClient({ gatewayUrl: "http://127.0.0.1:8080" });
    expect(client.entities).toBeInstanceOf(EntitiesClient);
    expect(state.evaluated).toBe(false);

    // Requests that fail before any reading -- a missing or malformed CID --
    // must fail without paying for the stack either.
    await expect(
      client.entities.load({ cid: "not-a-cid" })
    ).rejects.toThrow(DatasetNotFoundError);
    expect(state.evaluated).toBe(false);

    const entities = new EntitiesClient({
      gatewayUrl: "http://127.0.0.1:8080",
      fetch: (async () =>
        new Response(null, { status: 404 })) as typeof fetch,
    });
    await entities.load({ cid: REAL_CID }).catch(() => undefined);
    expect(state.evaluated).toBe(true);
  });

  it("forwards columnKey to EntityDataset.open", async () => {
    // Loaded dynamically so the laziness assertion above stays honest; by this
    // point the previous test has evaluated the module anyway.
    const reader = await import("@dclimate/tabular/reader");
    const seen: unknown[] = [];
    const spy = vi
      .spyOn(reader.EntityDataset, "open")
      .mockImplementation(async (_source, _root, opts) => {
        seen.push(opts);
        // The forwarding is observable at `open`; anything past it would need
        // a real dataset behind the gateway.
        throw new Error("stop before any I/O");
      });
    try {
      const entities = new EntitiesClient({ gatewayUrl: "http://127.0.0.1:8080" });
      const columnKey = (field: TableField): string => field.name.toUpperCase();

      await expect(
        entities.load({ cid: REAL_CID, columnKey })
      ).rejects.toThrow("stop before any I/O");
      expect(seen[0]).toEqual({ columnKey });

      // Absent must mean absent, so the reader's own identity default applies.
      await expect(entities.load({ cid: REAL_CID })).rejects.toThrow(
        "stop before any I/O"
      );
      expect(seen[1]).toEqual({});
    } finally {
      spy.mockRestore();
    }
  });
});
