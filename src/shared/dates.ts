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

