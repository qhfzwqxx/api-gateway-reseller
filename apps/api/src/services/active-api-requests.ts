type ActiveApiRequest = {
  controller: AbortController;
  startedAtMs: number;
};

const manualTerminateMessage = "手动终止";
const manualTerminateStatusCode = 499;
const manualTerminateUsageSource = "gateway_manual_termination";
const activeRequests = new Map<string, ActiveApiRequest>();

export function registerActiveApiRequest(requestId: string, controller: AbortController) {
  activeRequests.set(requestId, {
    controller,
    startedAtMs: Date.now(),
  });
}

export function unregisterActiveApiRequest(requestId: string, controller?: AbortController) {
  const current = activeRequests.get(requestId);
  if (!current) {
    return;
  }

  if (controller && current.controller !== controller) {
    return;
  }

  activeRequests.delete(requestId);
}

export function abortActiveApiRequest(requestId: string) {
  const current = activeRequests.get(requestId);
  if (!current) {
    return { aborted: false as const };
  }

  current.controller.abort(createManualTerminateError());
  return {
    aborted: true as const,
    startedAtMs: current.startedAtMs,
  };
}

export function countActiveApiRequests() {
  return activeRequests.size;
}

export function isManualTerminateError(error: unknown) {
  return error instanceof Error && error.message === manualTerminateMessage;
}

export function createManualTerminateUsage(abortedActiveRequest: boolean) {
  return {
    source: manualTerminateUsageSource,
    manualTerminated: true,
    abortedActiveRequest,
    reason: "admin_manual_termination",
  };
}

export function createManualTerminateError() {
  return new Error(manualTerminateMessage);
}

export {
  manualTerminateMessage,
  manualTerminateStatusCode,
  manualTerminateUsageSource,
};
