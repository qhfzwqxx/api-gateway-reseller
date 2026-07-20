import { recordModelPoolUserCallResult } from "../model-pool-call-failures.js";
import {
  clearSessionModelPoolChannelFailures,
  markSessionModelPoolChannelFailed,
} from "../model-pool-session-failover.js";
import { recordStickyModelPoolResult } from "../model-pool-stickiness.js";
import type { RoutingFeedbackInput } from "./types.js";

export async function recordRoutingFeedback(input: RoutingFeedbackInput) {
  if (
    input.failed === true &&
    input.retryableFailure === true &&
    input.channelId
  ) {
    await markSessionModelPoolChannelFailed(
      input.callerIdentity,
      input.model,
      input.channelId,
    );
  } else if (input.failed === false) {
    await clearSessionModelPoolChannelFailures(
      input.callerIdentity,
      input.model,
    );
  }

  await recordStickyModelPoolResult({
    callerIdentity: input.callerIdentity,
    model: input.model,
    channelId: input.channelId,
    upstreamProviderKeyId: input.upstreamProviderKeyId,
    failed: input.failed,
    retryableFailure: input.retryableFailure,
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
