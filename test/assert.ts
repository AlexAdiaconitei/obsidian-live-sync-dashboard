import assert from "node:assert/strict";

export {
  deepStrictEqual as assertEquals,
  match as assertMatch,
  ok as assert,
} from "node:assert/strict";

export function assertExists<T>(value: T, message?: string): asserts value is NonNullable<T> {
  assert.notEqual(value, null, message);
  assert.notEqual(value, undefined, message);
}

export function assertFalse(value: unknown, message?: string): void {
  assert.equal(value, false, message);
}

export function assertStringIncludes(value: string, expected: string, message?: string): void {
  assert.ok(value.includes(expected), message ?? `Expected string to include ${expected}`);
}

type ErrorClass = new (...args: never[]) => Error;

function expectedError(errorClass?: ErrorClass, includes?: string) {
  return (error: unknown): boolean =>
    (!errorClass || error instanceof errorClass) &&
    (!includes || (error instanceof Error && error.message.includes(includes)));
}

export function assertThrows(
  action: () => unknown,
  errorClass?: ErrorClass,
  includes?: string,
): void {
  assert.throws(action, expectedError(errorClass, includes));
}

export async function assertRejects(
  action: () => Promise<unknown>,
  errorClass?: ErrorClass,
  includes?: string,
): Promise<void> {
  await assert.rejects(action, expectedError(errorClass, includes));
}
