/**
 * Names in place of keys, on request (`OtlpOptions.names`, `agentNames`).
 *
 * A backend lists services by `service.name`. With the key there, a map of
 * five agents is five 56-character strings nobody can tell apart, and a
 * counterparty is one more. A caller that wants handles asks for them; the key
 * stays on `agentmesh.agent` either way, and both encoders say the same thing.
 */
import { describe, it, expect } from "vitest";
import { otlpTraces, agentNames } from "../../src/internal/otlp.js";
import { otlpTracesProto } from "../../src/internal/otlp-proto.js";
import type { SpanData } from "../../src/internal/spans.js";
import type { NameLookup } from "../../src/naming-gate.js";

const ME = "UMEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const THEM = "UTHEMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const STRANGER = "USTRANGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function span(over: Partial<SpanData> = {}): SpanData {
  return {
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", span_id: "a1b2c3d4e5f60718", parent_span_id: null,
    agent_id: ME, kind: "producer", operation: "request", offering: "quote",
    started_at: "2026-10-02T12:00:00.000Z", ended_at: "2026-10-02T12:00:00.100Z",
    duration_ms: 100, status: "ok", tags: { peer: THEM },
    ...over,
  };
}

type Json = { resourceSpans: { resource: { attributes: Attr[] }; scopeSpans: { spans: { attributes: Attr[] }[] }[] }[] };
type Attr = { key: string; value: { stringValue: string } };
const get = (attrs: Attr[], key: string) => attrs.find((a) => a.key === key)?.value.stringValue;

describe("OtlpOptions.names", () => {
  it("leaves keys alone unless asked", () => {
    const out = otlpTraces([span()]) as Json;
    const rs = out.resourceSpans[0]!;
    expect(get(rs.resource.attributes, "service.name")).toBe(ME);
    expect(get(rs.scopeSpans[0]!.spans[0]!.attributes, "agentmesh.peer")).toBe(THEM);
  });

  it("names the service and the peer, and keeps the key on agentmesh.agent", () => {
    const names = { [ME]: "planner.ann@example.com", [THEM]: "supplier.bob@example.com" };
    const out = otlpTraces([span()], { names }) as Json;
    const rs = out.resourceSpans[0]!;
    expect(get(rs.resource.attributes, "service.name")).toBe("planner.ann@example.com");
    expect(get(rs.resource.attributes, "agentmesh.agent")).toBe(ME);
    expect(get(rs.scopeSpans[0]!.spans[0]!.attributes, "agentmesh.peer")).toBe("supplier.bob@example.com");
  });

  it("falls back to the key for an agent it has no name for", () => {
    const out = otlpTraces([span({ tags: { peer: STRANGER } })], { names: { [ME]: "planner.ann@example.com" } }) as Json;
    expect(get(out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes, "agentmesh.peer")).toBe(STRANGER);
  });

  it("is applied the same way by the protobuf encoder", () => {
    const names = { [ME]: "planner.ann@example.com", [THEM]: "supplier.bob@example.com" };
    const wire = new TextDecoder().decode(otlpTracesProto([span()], { names }));
    expect(wire).toContain("planner.ann@example.com");
    expect(wire).toContain("supplier.bob@example.com");
    expect(wire).not.toContain(THEM);
    expect(wire).toContain(ME); // agentmesh.agent
  });
});

describe("agentNames", () => {
  it("asks once per key, emitter and peer alike, and keeps only verified names", async () => {
    const asked: string[] = [];
    const lookup: NameLookup = async (key) => {
      asked.push(key);
      if (key === ME) return { status: "named", handle: "planner.ann@example.com" };
      if (key === THEM) return { status: "unreachable" };
      return { status: "unnamed", handle: "not-standard" };
    };
    const names = await agentNames([span(), span(), span({ tags: { peer: STRANGER } })], lookup);
    expect(asked.sort()).toEqual([ME, STRANGER, THEM].sort());
    expect(names).toEqual({ [ME]: "planner.ann@example.com" });
  });
});
