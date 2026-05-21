export type CliCycleResult = {
	cycleId: string;
	status: string;
	outcome: string;
};

/** Parse the final `cli cycle` JSON block from stdout (alerts may precede it). */
export function parseCliCycleStdout(stdout: string): CliCycleResult {
	const marker = '"previewMode"';
	const markerIdx = stdout.lastIndexOf(marker);
	if (markerIdx === -1) {
		throw new Error("No cycle result in stdout (missing previewMode)");
	}

	const start = stdout.lastIndexOf("{", markerIdx);
	if (start === -1) {
		throw new Error("No cycle result object start in stdout");
	}

	let depth = 0;
	let end = -1;
	for (let i = start; i < stdout.length; i++) {
		const ch = stdout[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	if (end === -1) {
		throw new Error("Unterminated cycle result JSON in stdout");
	}

	const parsed = JSON.parse(stdout.slice(start, end)) as {
		cycleId?: string;
		status?: string;
		outcome?: string;
	};
	if (!parsed.cycleId || !parsed.status || !parsed.outcome) {
		throw new Error("Cycle result JSON missing cycleId, status, or outcome");
	}

	return {
		cycleId: parsed.cycleId,
		status: parsed.status,
		outcome: parsed.outcome,
	};
}
