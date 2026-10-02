/**
 * The consumer half of a hop (SPEC.md §13.1.1), through the real dispatch path.
 *
 * The sender closes its producer span on the request envelope's own trace, so
 * the envelope's span_id IS the producer span. The consumer span must be a new
 * span parented under it: if it carried the envelope's trace unchanged, both
 * halves of one hop would share a span_id, the consumer would be the producer's
 * sibling rather than its child, and every call the handler makes would hang
 * off an id that belongs to two spans. A collector that derives a call graph
 * from parentage then double-counts the hop and invents edges.
 *
 * trace-continuity.test.ts builds the consumer span by hand; this one makes the
 * responder close it, which is the path a deployed agent runs.
 */
import { describe, it, expect, vi } from "vitest";
import { nkeys } from "nats.ws";
import { MeshNode } from "../../src/node.js";
import { createEnvelope } from "../../src/internal/envelope-builder.js";
import { signEnvelope } from "../../src/internal/identity.js";
import { encode, decode, decodeUnverified } from "../../src/internal/codec.js";
import { newTraceContext } from "../../src/internal/trace.js";
import { Subjects } from "../../src/internal/subjects.js";
import type { ConnectionManager } from "../../src/internal/connection.js";
import type { SpanData } from "../../src/internal/spans.js";
import type { TraceContext } from "../../src/types/envelope.js";

function makeConn() {
  const registryKp = nkeys.createUser();
  const published: { subject: string; data: Uint8Array }[] = [];
  const inboxHandlers = new Map<string, (msg: unknown) => void>();
  return {
    published,
    inboxHandlers,
    raw: { publish: vi.fn() },
    publish: vi.fn((subject: string, data: Uint8Array) => published.push({ subject, data })),
    // Answers register(); a request to another agent gets no reply and times out.
    request: vi.fn(async (_subject: string, data: Uint8Array) => {
      const req = decode(data);
      return {
        data: encode(
          signEnvelope(
            createEnvelope({
              type: "respond",
              from: registryKp.getPublicKey(),
              to: req.from,
              in_reply_to: req.id,
              payload: { status: "registered" },
            }),
            registryKp,
          ),
        ),
      };
    }),
    subscribe: vi.fn((subject: string, cb: (msg: unknown) => void) => {
      inboxHandlers.set(subject, cb);
      return { unsubscribe: () => {}, drain: async () => {} };
    }),
    drain: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    get isClosed() {
      return false;
    },
  };
}

function spansOn(conn: ReturnType<typeof makeConn>): SpanData[] {
  return conn.published
    .filter((p) => p.subject.startsWith("mesh.trace."))
    .map((p) => (decodeUnverified(p.data).payload as { data: SpanData }).data);
}

describe("the consumer span (§13.1.1)", () => {
  it("is its own span, parented under the producer, and parents the handler's calls", async () => {
    const conn = makeConn();
    const node = MeshNode.withConnection(conn as unknown as ConnectionManager, nkeys.createUser(), undefined, {
      emitSpans: true,
    });
    const agent = node.addAgent();
    let handlerTrace: TraceContext | undefined;
    agent.onRequest("research", async (_input, ctx) => {
      handlerTrace = ctx.traceContext;
      // A delegation from inside the handler: its producer span must hang off
      // this agent's consumer span, not off the caller's producer span.
      await agent.request(nkeys.createUser().getPublicKey(), "fetch", {}, { timeout_ms: 20 }).catch(() => {});
      return { ok: true };
    });
    await agent.register({ name: "researcher" });

    // The caller's request. Its trace is the caller's producer span.
    const callerKp = nkeys.createUser();
    const producer = newTraceContext();
    const req = signEnvelope(
      createEnvelope({
        type: "request",
        from: callerKp.getPublicKey(),
        to: agent.id,
        trace: producer,
        payload: { offering: "research", input: {} },
      }),
      callerKp,
    );
    conn.inboxHandlers.get(Subjects.agentInbox(agent.id))!({
      data: encode(req),
      subject: Subjects.agentInbox(agent.id),
      reply: "_INBOX.abc123",
      respond: () => true,
    });

    await vi.waitFor(() => expect(spansOn(conn).some((s) => s.kind === "consumer")).toBe(true));
    const consumer = spansOn(conn).find((s) => s.kind === "consumer")!;
    const delegated = spansOn(conn).find((s) => s.kind === "producer")!;

    expect(consumer.trace_id).toBe(producer.trace_id);
    expect(consumer.parent_span_id).toBe(producer.span_id);
    expect(consumer.span_id).not.toBe(producer.span_id);

    expect(handlerTrace?.span_id).toBe(consumer.span_id);
    expect(delegated.trace_id).toBe(producer.trace_id);
    expect(delegated.parent_span_id).toBe(consumer.span_id);
  });
});
