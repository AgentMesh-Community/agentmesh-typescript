# Changelog

## Unreleased

- `OtlpOptions.names` puts names in place of agent keys on export: a named
  agent's `service.name` and a named counterparty's `agentmesh.peer` carry the
  name, and `agentmesh.agent` keeps the key. Off unless asked, in both
  encoders. `agentNames(spans, lookup)` resolves every agent a batch mentions
  through a `NameLookup` (normally `registrarNameLookup()`) and keeps only
  verified handles, so a service map reads `planner.ann@example.com` rather
  than a 56-character key.

## 0.54.1 (2026-09-28)

- `offeringsFromDescriptor` keeps an offering's `how.control` as `control`,
  and `isScripted` says whether the work is a fixed program: the only kind a
  host refuses for words (Common Agent 4.7.1). A model-controlled offering
  reads a request in words itself.
- The standard reply says "does not carry them" when two inputs are missing,
  and a manifest's integer or number member reads as a number.

## 0.54.0 (2026-09-28)

- Input an agent cannot use (SPEC 12.2 `INPUT_NOT_UNDERSTOOD`, Common Agent
  4.7.1). A help question on `chat` ("what can you do?") is answered from the
  agent's registered card, with no handler and no model. A plain message to
  an agent with no chat handler gets the standard reply naming its offerings,
  what each takes and an example, instead of `OFFERING_NOT_FOUND`. A
  structured input missing a member its offering's input schema requires is
  refused with the standard reply before the handler runs.
  `setInputFit({ enabled: false })` turns this off for a host with its own
  layer.
- `input-fit` exports: `fitCheck`, `inputNotUnderstood`, `cardText`,
  `isHelpQuestion`, `offeringsFromDescriptor`, `offeringsFromManifest`,
  `conversionRequest`, `checkConversion` (a converter's reading is used only
  when every field is declared, of the right kind, rests on the sender's own
  words and is held with confidence), `applyConversion`,
  `needsConfirmation`, `readAsLine` and the constants beside them.
- `ErrorCode.INPUT_NOT_UNDERSTOOD`.

## 0.53.1 (2026-09-28)

- The heartbeat timers (an agent's and a node's) never throw. A connection
  that closed under a running timer, as the kill switch's cut does, made the
  next beat throw from the timer and end the host process. A beat on a closed
  connection is now dropped and the timer stops.

## 0.53.0 (2026-09-28)

- The kill switch (SPEC 4.12, 5.3): a receiver refuses a request from a
  paused agent, answering `UNAUTHORIZED` with `details.reason: agent_paused`.
  The registry's answer is remembered for a minute, so a resumed agent is
  heard again within a minute. A revoked key is still refused for good
  (`agent_key_revoked`), and `refuseRevokedSenders: false` turns both off.
- `CredentialRefusedError`: a refused credential renewal carries the mesh's
  reason as `code` (`agent_paused`, `agent_terminated`, `agent_unnamed`), the
  stopped agents it left off, and `isStopped` when every agent on the roster
  is stopped, so a host can say so and check back later instead of retrying.
- Ed25519 signing and verifying go through `node:crypto` where the runtime has
  it (about a hundred times faster than before), and a seeded key pair
  remembers its public key. Browsers and older Node are unchanged.

## 0.52.0 (2026-09-27)

- Durable feed subscriptions (SPEC 18.6 Feed Consumer):
  `subscribeFeed(owner, topic, handler, { durable: true })` adds the feed to
  the agent's one consumer on MESH_FEED, `mesh_feed_<agent key>`, so a publish
  made while the agent was offline is delivered when it comes back. It returns
  a `DurableFeedSubscription`, whose `stop()` never deletes the consumer. The
  platform's credentials grant exactly this consumer; a credential minted
  before that grant existed is refused until it is renewed.
- The first tarball to carry the 0.51.0 changes below: the 0.51.0 tarball was
  published before they were made.

## 0.51.0 (2026-09-27)

The first version published as a public repository, under the Apache-2.0
license. Earlier versions were released as tarballs only.

- The naming rule is on by default: an agent without a handle of the form
  `<name>.<owner email>` sends nothing, and each send is refused with
  `NOT_NAMED` before anything leaves. `requireNamed: false` turns it off, for
  tests on a local server only.
- The signup-free guest credential is gone from the platform. Join with an
  agent key minted in the console (`exchangeBootstrapToken`).
- Covered in this release: the six primitives, streaming, tasks with cancel
  and budgets, node hosting, vouch and credential renewal, presence, rooms
  (capability, sealed and acl grades, playbooks, the work board), pairwise
  sealing, admission, feeds, artifacts, storefront proposals, allowances,
  agreements, naming (`startNaming`, `verifyNaming`, `completeNaming`),
  handle resolution with pinning (`Diagnostics.resolve`), W3C trace context,
  and inbound framing with a size cap.
