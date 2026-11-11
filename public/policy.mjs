/**
 * Policy Gatekeeper — deterministic preflight for an action executor.
 * A caller should invoke its executor only after an `allow` result.
 */
export const policy = Object.freeze({
  spendLimit: 250,
  allowedDestinations: ['0x71c7656ec7ab88b098defb751b7401b5f6d8976f', '0x9f2a6d31c08b4e57a1d3906c6b277e58f2d104ab'],
  window: { start: '09:00', end: '17:00', timezone: 'UTC', weekdaysOnly: true }
});

const normalized = value => String(value ?? '').trim().toLowerCase();
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function evaluateAction(action, config = policy) {
  const amount = Number(action.amount);
  const asset = action.asset || 'USD';
  const amountValid = Number.isFinite(amount) && amount > 0;
  const underLimit = amountValid && amount <= config.spendLimit;
  const destinationAllowed = config.allowedDestinations.map(normalized).includes(normalized(action.destination));
  const { start, end, timezone, weekdaysOnly } = config.window;
  let timeAllowed = false;
  let timeReason;
  const configValid = validTime(start) && validTime(end) && Boolean(timezone);
  if (configValid) {
    try {
      const date = new Date(action.at || Date.now());
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const part = key => parts.find(item => item.type === key)?.value;
      const now = `${part('hour')}:${part('minute')}`;
      const weekday = part('weekday');
      const withinHours = start <= end ? now >= start && now < end : now >= start || now < end;
      timeAllowed = withinHours && !(weekdaysOnly && ['Sat', 'Sun'].includes(weekday));
      timeReason = timeAllowed ? `Inside ${start}–${end} ${timezone}.` : `Outside ${start}–${end} ${timezone}${weekdaysOnly ? ' weekday' : ''} window.`;
    } catch {
      timeReason = 'Time zone is not recognized.';
    }
  } else timeReason = 'Time-window policy configuration is invalid.';

  const checks = [
    { rule: 'spend limit', label: 'Spend cap', passed: underLimit, reason: !amountValid ? 'Amount must be positive.' : underLimit ? `Within ${config.spendLimit} ${asset} cap.` : `${amount} ${asset} exceeds the ${config.spendLimit} ${asset} cap.` },
    { rule: 'destination allowlist', label: 'Allowlist', passed: destinationAllowed, reason: destinationAllowed ? 'Destination is approved.' : 'Destination is not on the approved address list.' },
    { rule: 'time window', label: 'Time window', passed: timeAllowed, reason: timeReason }
  ];
  const failed = checks.find(check => !check.passed);
  return failed
    ? { decision: 'deny', rule: failed.rule, reason: failed.reason, checks }
    : { decision: 'allow', rule: 'all checks passed', reason: 'Amount, destination, and time window all passed.', checks };
}

/** Gate an executor so denied requests cannot reach it. */
export async function runGuarded(action, executor, config = policy) {
  const result = evaluateAction(action, config);
  if (result.decision === 'deny') return { ...result, executed: false };
  const output = await executor(action);
  return { ...result, executed: true, output };
}
