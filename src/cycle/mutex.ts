let cycleInFlight = false;

export function isCycleInFlight(): boolean {
	return cycleInFlight;
}

/**
 * Runs `fn` only when no cycle is in flight; sets mutex for duration.
 * Returns `null` when skipped due to overlap.
 */
export async function withCycleMutex<T>(fn: () => Promise<T>): Promise<T | null> {
	if (cycleInFlight) {
		return null;
	}
	cycleInFlight = true;
	try {
		return await fn();
	} finally {
		cycleInFlight = false;
	}
}

/** Test helper — reset mutex state. */
export function resetCycleMutex(): void {
	cycleInFlight = false;
}
