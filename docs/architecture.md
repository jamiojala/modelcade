# Architecture

`modelcade` is organized around a small set of abstractions.

## Core Types

- `ModelProvider`: provider adapter contract
- `GatewayRequest`: normalized generation input
- `ModelcadeResponse`: normalized generation output
- `ModelcadeStreamEvent`: normalized streaming event union

## Runtime Flow

1. Resolve model route list (`model` + `fallback` chain).
2. Attempt each route in order.
3. For each route:
   - send request to provider adapter
   - normalize text/tool/usage output
   - if tool calls exist, execute local tools and continue
4. Return final response or continue to next fallback route on failure.

## Separation of Concerns

- Provider adapters:
  - map normalized messages to provider-specific payloads
  - parse provider responses into normalized output
- Gateway:
  - fallback policy
  - tool loop orchestration
  - attempt tracking
  - stream event normalization

## Design Goals

- provider swap with minimal app changes
- deterministic, typed surface area
- explicit fallback behavior
- stream and non-stream parity
