/**
 * OpenStreetMap `opening_hours`, the common part of it: weekday ranges and lists, time ranges
 * (also past midnight), `off`, `24/7`, later rules overriding earlier ones for their days.
 * Anything beyond that (months, weeks, sunrise, holidays alone, comments) gives `null`, and
 * the card shows the text as it is rather than a guess.
 */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY = 1440;
const WEEK = 7 * DAY;

/** Open spans in minutes from Monday 00:00; a span past Sunday midnight runs into Monday. */
export type Week = [number, number][];

const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
const DAYS_RE = new RegExp(
  `^(${DAY_RE}(?:-${DAY_RE})?(?:\\s*,\\s*${DAY_RE}(?:-${DAY_RE})?)*)(?:\\s+|$)`,
);
const TIME_RE = /^([01]?\d|2[0-4]):([0-5]\d)-([01]?\d|2[0-4]):([0-5]\d)$/;

function days(list: string): number[] | 'holiday' {
  const out = new Set<number>();
  let holiday = false;
  for (const part of list.split(',').map((p) => p.trim())) {
    const [a, b] = part.split('-');
    if (a === 'PH' || a === 'SH') {
      holiday = true;
      continue;
    }
    const from = DAYS.indexOf(a);
    const to = b ? DAYS.indexOf(b) : from;
    if (from < 0 || to < 0) return [];
    for (let d = from; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === to) break;
    }
  }
  return out.size ? [...out] : holiday ? 'holiday' : [];
}

function times(text: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of text.split(',').map((p) => p.trim())) {
    const m = TIME_RE.exec(part);
    if (!m) return null;
    const start = +m[1] * 60 + +m[2];
    const end = +m[3] * 60 + +m[4];
    out.push([start, end > start ? end : end + DAY]);
  }
  return out;
}

export function parseHours(spec: string): Week | null {
  const text = spec.trim();
  if (!text || text.includes('||') || text.includes('"')) return null;
  const perDay: [number, number][][] = DAYS.map(() => []);
  for (const raw of text.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    if (rule === '24/7') {
      for (let d = 0; d < 7; d++) perDay[d] = [[0, DAY]];
      continue;
    }
    const m = DAYS_RE.exec(rule);
    const which = m ? days(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    const rest = (m ? rule.slice(m[0].length) : rule).trim();
    if (which === 'holiday') continue; // Holidays need a calendar; the weekdays still hold.
    if (!which.length) return null;
    let spans: [number, number][] | null;
    if (rest === 'off' || rest === 'closed') spans = [];
    else if (rest === '' || rest === '24/7') spans = [[0, DAY]];
    else spans = times(rest);
    if (!spans) return null;
    for (const d of which) perDay[d] = spans;
  }
  return perDay.flatMap((spans, d) =>
    spans.map(([s, e]): [number, number] => [d * DAY + s, d * DAY + e]),
  );
}

export type HoursState =
  | { open: true; always: true }
  | { open: boolean; always?: false; /** When it closes or opens next. */ change: Date }
  | { open: false; never: true };

/** Minutes since Monday 00:00 in local time. */
const minuteOfWeek = (d: Date) => ((d.getDay() + 6) % 7) * DAY + d.getHours() * 60 + d.getMinutes();

/** Open now or not, and until when, by the device's clock. */
export function hoursState(week: Week, now: Date): HoursState {
  if (!week.length) return { open: false, never: true };
  // Spans as they repeat over this week and the next, to see across Sunday night.
  const spans = [...week, ...week.map(([s, e]): [number, number] => [s + WEEK, e + WEEK])].sort(
    (a, b) => a[0] - b[0],
  );
  const m = minuteOfWeek(now);
  const at = (minute: number) => {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + (minute - m));
    return d;
  };
  const inside =
    spans.find(([s, e]) => s <= m && m < e) ??
    spans.find(([s, e]) => s <= m + WEEK && m + WEEK < e);
  if (inside) {
    // Follow spans that touch or overlap until a gap: that is when it closes.
    const base = inside[0] <= m ? 0 : -WEEK;
    let end = inside[1] + base;
    for (let grew = true; grew;) {
      grew = false;
      for (const [s, e] of spans) {
        if (s + base <= end && e + base > end) {
          end = e + base;
          grew = true;
        }
      }
      if (end - m >= WEEK) return { open: true, always: true };
    }
    return { open: true, change: at(end) };
  }
  const next = spans.map(([s]) => s).find((s) => s > m)!;
  return { open: false, change: at(next) };
}
