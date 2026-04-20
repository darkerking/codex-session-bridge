import * as crypto from "node:crypto";

export function createOperationId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}

export function normalizeProvider(provider: string | null | undefined): string | null {
  const value = provider?.trim();
  return value ? value : null;
}
