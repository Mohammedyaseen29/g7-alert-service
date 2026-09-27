export type ReportPeriod = 'day' | 'week' | 'month' | 'all';

export type ReportRangeRequest = {
  period?: ReportPeriod;
  from?: string;
  to?: string;
};

export class ReportRangeError extends Error {
  constructor(message: string) { super(message); this.name = 'ReportRangeError'; }
}

const DAY_MS = 86_400_000;
const PERIOD_MS: Record<Exclude<ReportPeriod, 'all'>, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

export function resolveReportRange(request: ReportRangeRequest, serverNow: Date, firstAvailable?: Date | null): { from: Date; to: Date } {
  if (request.period) {
    const from = request.period === 'all'
      ? firstAvailable ?? new Date(serverNow.getTime() - DAY_MS)
      : new Date(serverNow.getTime() - PERIOD_MS[request.period]);
    if (!(from < serverNow)) throw new ReportRangeError('No saved readings are available in this period');
    return { from, to: serverNow };
  }

  let to = request.to ? new Date(request.to) : serverNow;
  let from = request.from ? new Date(request.from) : new Date(to.getTime() - DAY_MS);
  if (to > serverNow) {
    // An older installed PWA sends browser-clock timestamps for rolling presets.
    const duration = to.getTime() - from.getTime();
    if (Object.values(PERIOD_MS).includes(duration)) {
      to = serverNow;
      from = new Date(serverNow.getTime() - duration);
    } else to = serverNow; // A custom period can include every reading available so far.
  }
  if (!(from < to) || to > serverNow) throw new ReportRangeError('Choose a valid report period ending no later than now');
  return { from, to };
}
