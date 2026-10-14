import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfiguration {
  host: string;
  port: number;
  dataDirectory: string;
  distDirectory: string;
  webAccessApiBase: string;
  webAccessProject: string;
  webAccessUsername: string;
  webAccessPassword: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsedValue: number = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

export const serverConfiguration: ServerConfiguration = {
  host: process.env['HOST'] ?? '0.0.0.0',
  port: parsePositiveInteger(process.env['PORT'], 3006),
  dataDirectory: process.env['DATA_DIRECTORY'] ?? 'data',
  distDirectory: process.env['DIST_DIRECTORY'] ?? 'dist',
  webAccessApiBase: process.env['WEBACCESS_API_BASE'] ?? '',
  webAccessProject: process.env['WEBACCESS_PROJECT'] ?? '',
  webAccessUsername: process.env['WEBACCESS_USERNAME'] ?? '',
  webAccessPassword: process.env['WEBACCESS_PASSWORD'] ?? '',
  pollIntervalMs: parsePositiveInteger(process.env['POLL_INTERVAL_MS'], 2000),
  requestTimeoutMs: parsePositiveInteger(process.env['WEBACCESS_TIMEOUT_MS'], 5000),
};
