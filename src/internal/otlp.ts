/**
 * Mesh spans to OTLP (SPEC.md §13.1.1, §13.4).
 *
 * A pure function, in the SDK rather than in the exporter, for two reasons.
 * Anyone writing their own collector should not have to re-derive the mapping
 * from a payload; and a conversion that only exists inside a CLI is a
 * conversion nobody can test against the emitter that produces its input.
 *
 * JSON deliberately, because it costs no code generation and nothing to keep in
 * sync, which is what a long-lived sidecar wants. It is not universally
 * accepted, so `otlp-proto.ts` carries a hand-written protobuf encoder for the
 * backends that refuse it.
 *
 * §13.4's division of labour is what makes the output useful: OpenTelemetry
 * describes what happens inside an agent, the mesh describes what happens
 * between them, and the two compose into one trace because they already share
 * W3C Trace Context. Nothing here translates an identifier.
 */
import type { SpanData } from "./spans.js";
import type { NameLookup } from "../naming-gate.js";

/** OTLP span kinds from the OpenTelemetry proto. */
const OTLP_KIND: Record<string, number> = { producer: 4, consumer: 5 };
/** OTLP status codes: 0 UNSET, 1 OK, 2 ERROR. */
const OTLP_STATUS: Record<string, number> = { ok: 1, error: 2, refused: 2, timeout: 2, canceled: 2 };

export interface OtlpOptions {
  /** Reported as the instrumentation scope version. */
  scopeVersion?: string;
  /**
   * Extra resource attributes, merged onto every resource.
   *
   * This exists because backends demand their own. Google's Telemetry API
   * refuses a payload outright with `Resource is missing required attribute
   * "gcp.project_id"`, and that is a fact about one vendor rather than about
   * OTLP, so it belongs in a caller's configuration and not hardcoded here.
   * A vendor key baked into the SDK is a vendor key every other user carries.
   */
  resourceAttributes?: Record<string, string>;
  /**
   * Names to show for agent keys, keyed by the key: usually the verified
   * handles `agentNames` resolves. A named agent's `service.name` and a named
   * counterparty's `agentmesh.peer` carry the name instead of the key (§13.1.1
   * allows either for the peer); `agentmesh.agent` always keeps the key, so
   * nothing that identifies an agent is lost.
   *
   * Opt-in because a backend lists services by `service.name`, and a
   * 56-character key is a name nobody can pick out of a service map, while a
   * handle carries its owner's email into tooling the counterparty did not
   * choose. Which of those matters more is the operator's call, not the SDK's.
   */
  names?: Record<string, string>;
}

/**
 * The verified names of every agent a batch of spans mentions, emitter and
 * counterparty alike, for `OtlpOptions.names`. Asks `lookup` (normally
 * `registrarNameLookup()`) once per distinct key; a key that is unnamed or
 * cannot be checked is left out, so it is exported as its key.
 */
export async function agentNames(spans: SpanData[], lookup: NameLookup): Promise<Record<string, string>> {
  const keys = new Set<string>();
  for (const s of spans) {
    if (s.agent_id) keys.add(s.agent_id);
    if (s.tags?.peer) keys.add(s.tags.peer);
  }
  const names: Record<string, string> = {};
  await Promise.all(
    [...keys].map(async (key) => {
      const check = await lookup(key);
      if (check.status === "named" && check.handle) names[key] = check.handle;
    }),
  );
  return names;
}

function attr(key: string, value: string) {
  return { key, value: { stringValue: String(value) } };
}

function nanos(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? String(BigInt(ms) * 1_000_000n) : "0";
}

/**
 * Build one OTLP `ExportTraceServiceRequest` from completed mesh spans.
 *
 * Grouped by emitting agent, so each mesh agent arrives at the collector as
 * its own `service.name` rather than every agent on a host collapsing into one
 * blob that nobody can filter.
 */
export function otlpTraces(spans: SpanData[], opts: OtlpOptions = {}): unknown {
  const byAgent = new Map<string, SpanData[]>();
  for (const s of spans) {
    const key = s.agent_id || "unknown";
    const list = byAgent.get(key);
    if (list) list.push(s);
    else byAgent.set(key, [s]);
  }

  return {
    resourceSpans: [...byAgent].map(([agentId, group]) => ({
      resource: {
        attributes: [
          attr("service.name", opts.names?.[agentId] ?? agentId),
          attr("agentmesh.agent", agentId),
          ...Object.entries(opts.resourceAttributes ?? {}).map(([k, v]) => attr(k, v)),
        ],
      },
      scopeSpans: [
        {
          scope: { name: "agentmesh", version: opts.scopeVersion ?? "" },
          spans: group.map((s) => {
            const attributes = [
              // OpenInference (the convention Phoenix and its lineage read) so
              // a mesh hop identifies itself instead of rendering as UNKNOWN
              // beside properly typed agent spans. It is a type label and
              // carries no content, so it costs nothing against §13.1.1's
              // refusals. AGENT rather than TOOL: both ends of this hop are
              // agents, and calling one is not the same act as invoking a tool
              // inside your own process.
              attr("openinference.span.kind", "AGENT"),
              attr("agentmesh.primitive", s.operation),
              attr("agentmesh.outcome", s.status),
            ];
            if (s.offering) attributes.push(attr("agentmesh.offering", s.offering));
            if (s.error_code) attributes.push(attr("agentmesh.error_code", s.error_code));
            if (s.tags?.peer) attributes.push(attr("agentmesh.peer", opts.names?.[s.tags.peer] ?? s.tags.peer));
            if (s.tags?.task_id) attributes.push(attr("agentmesh.task_id", s.tags.task_id));
            if (s.tags?.context_id) attributes.push(attr("agentmesh.context_id", s.tags.context_id));

            const out: Record<string, unknown> = {
              traceId: s.trace_id,
              spanId: s.span_id,
              name: s.offering ? `${s.operation} ${s.offering}` : s.operation,
              kind: OTLP_KIND[s.kind] ?? 0,
              startTimeUnixNano: nanos(s.started_at),
              endTimeUnixNano: nanos(s.ended_at),
              attributes,
              status: { code: OTLP_STATUS[s.status] ?? 0 },
            };
            // Omitted rather than empty for a root: an empty parentSpanId is a
            // valid OTLP encoding but several collectors render it as a broken
            // link rather than as a root.
            if (s.parent_span_id) out.parentSpanId = s.parent_span_id;
            return out;
          }),
        },
      ],
    })),
  };
}
