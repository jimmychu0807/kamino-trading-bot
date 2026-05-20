export type AlertEventName =
	| "metrics_stale"
	| "rpc_timeout"
	| "vault_unavailable"
	| "dependency_hold_entered"
	| "dependency_hold_cleared"
	| "execution_hold_entered"
	| "critical_risk_exit"
	| "cycle_timeout"
	| "tx_leg_failed"
	| "rebalance_executed"
	| "rebalance_skipped";

export type AlertPayload = {
	event: AlertEventName;
	timestamp: string;
	cycleId?: string;
	message: string;
	details?: Record<string, unknown>;
};

export type EmitAlertOptions = {
	webhookUrl?: string;
};

function logAlert(payload: AlertPayload): void {
	console.log(JSON.stringify(payload));
}

async function postWebhook(url: string, payload: AlertPayload): Promise<void> {
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	} catch {
		// Non-blocking — webhook failures must not block cycle completion.
	}
}

/** Emit structured alert to stdout and optionally POST to webhook (FR-015). */
export function emitAlert(payload: AlertPayload, options: EmitAlertOptions = {}): void {
	logAlert(payload);
	const webhookUrl = options.webhookUrl?.trim();
	if (webhookUrl) {
		void postWebhook(webhookUrl, payload);
	}
}

export function alertFromEnv(
	event: AlertEventName,
	params: {
		cycleId?: string;
		message: string;
		details?: Record<string, unknown>;
		now?: Date;
	},
	env: Record<string, string | undefined> = process.env,
): void {
	emitAlert(
		{
			event,
			timestamp: (params.now ?? new Date()).toISOString(),
			cycleId: params.cycleId,
			message: params.message,
			details: params.details,
		},
		{ webhookUrl: env.ALERT_WEBHOOK_URL },
	);
}
