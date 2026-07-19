import { recordModelPoolUserCallResult } from "../model-pool-call-failures.js";
import { recordStickyModelPoolResult } from "../model-pool-stickiness.js";
import type { RoutingFeedbackInput } from "./types.js";

export async function recordRoutingFeedback(input: RoutingFeedbackInput) {
  await recordStickyModelPoolResult({
    callerIdentity: input.callerIdentity,
    model: input.model,
    channelId: input.channelId,
    upstreamProviderKeyId: input.upstreamProviderKeyId,
    failed: input.failed,
    streamed: input.streamed,
    firstTokenLatencyMs: input.firstTokenLatencyMs,
    latencyMs: input.latencyMs,
    ignoreSlowPenalty: input.ignoreSlowPenalty,
  });

  await recordModelPoolUserCallResult({
    userId: input.userId,
    apiKeyId: input.apiKeyId,
    callerIdentity: input.callerIdentity,
    model: input.model,
    channelId: input.channelId,
    upstreamProviderKeyId: input.upstreamProviderKeyId,
    failed: input.failed,
    retryableFailure: input.retryableFailure,
    firstTokenLatencyMs: input.firstTokenLatencyMs,
    latencyMs: input.latencyMs,
    logger: input.logger,
  });
}
