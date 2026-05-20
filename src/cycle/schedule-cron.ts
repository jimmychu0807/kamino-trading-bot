export type InProcessCronJob = {
	stop: () => void;
};

/**
 * Schedules an in-process callback from a cron expression using `Bun.cron.parse`.
 * Bun 1.3.x `Bun.cron()` registers OS-level jobs only; this fills the gap until
 * callback-style `Bun.cron(schedule, fn)` ships.
 */
export function scheduleInProcessCron(
	expression: string,
	callback: () => void | Promise<void>,
): InProcessCronJob {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const scheduleNext = () => {
		if (stopped) {
			return;
		}

		const next = Bun.cron.parse(expression);
		if (!next) {
			throw new Error(`Invalid or non-matching cron expression: ${expression}`);
		}

		const delay = Math.max(0, next.getTime() - Date.now());
		timer = setTimeout(() => {
			void (async () => {
				if (stopped) {
					return;
				}
				try {
					await callback();
				} finally {
					scheduleNext();
				}
			})();
		}, delay);
	};

	scheduleNext();

	return {
		stop: () => {
			stopped = true;
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		},
	};
}
