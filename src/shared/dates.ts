export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

export function today(): Date {
  return new Date();
}

export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(a.getTime() - b.getTime()) / msPerDay;
}

export function isOlderThanDays(date: Date, days: number): boolean {
  return daysBetween(date, today()) > days;
}

