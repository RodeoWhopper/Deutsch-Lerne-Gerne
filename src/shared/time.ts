// Study day boundary: 04:00 Europe/Istanbul (UTC+3, no DST) = 01:00 UTC.
const H = 3600_000;
const D = 86400_000;
export const studyDay = (ms: number) => Math.floor((ms - H) / D);
export const dayStartMs = (day: number) => day * D + H;
export const dayLabel = (day: number) => new Date(dayStartMs(day) + 3 * H).toISOString().slice(0, 10);
