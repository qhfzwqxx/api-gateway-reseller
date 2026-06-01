-- Track the time from upstream response headers to the first streamed body chunk.
ALTER TABLE "ApiRequest" ADD COLUMN "upstreamFirstChunkLatencyMs" INTEGER;
