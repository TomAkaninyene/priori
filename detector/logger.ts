type LogFields = Record<string, unknown>;

function serialize(fields: LogFields): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === "bigint" ? value.toString() : JSON.stringify(value)}`)
    .join(" ");
}

function line(level: string, message: string, fields: LogFields): string {
  const suffix = serialize(fields);
  return suffix.length > 0
    ? `[${new Date().toISOString()}] ${level} ${message} ${suffix}`
    : `[${new Date().toISOString()}] ${level} ${message}`;
}

export const logger = {
  info(message: string, fields: LogFields = {}): void {
    console.log(line("INFO ", message, fields));
  },
  warn(message: string, fields: LogFields = {}): void {
    console.warn(line("WARN ", message, fields));
  },
  error(message: string, fields: LogFields = {}): void {
    console.error(line("ERROR", message, fields));
  },
};
