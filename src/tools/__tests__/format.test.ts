import { describe, expect, it } from "vitest";
import { definedOnly, json, promisify, toolError } from "../_format.js";

describe("definedOnly", () => {
  it("drops undefined keys but keeps falsy-but-defined values", () => {
    expect(definedOnly({ a: 1, b: undefined, c: 0, d: "", e: false })).toEqual({
      a: 1,
      c: 0,
      d: "",
      e: false,
    });
  });

  it("returns an empty object when everything is undefined", () => {
    expect(definedOnly({ a: undefined, b: undefined })).toEqual({});
  });
});

describe("json", () => {
  it("wraps a payload as compact JSON text content", () => {
    const result = json({ a: 1 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "text", text: '{"a":1}' });
  });
});

describe("toolError", () => {
  it("marks the result as an error", () => {
    const result = toolError("boom");
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: "text", text: "boom" });
  });
});

describe("promisify", () => {
  it("resolves with the callback's data", async () => {
    await expect(promisify<number>((cb) => cb(null, 42))).resolves.toBe(42);
  });

  it("rejects when the callback yields an error", async () => {
    await expect(
      promisify((cb) => cb(new Error("nope"), null)),
    ).rejects.toThrow("nope");
  });
});
