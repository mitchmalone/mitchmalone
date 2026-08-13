/**
 * Console reporting for the README build.
 *
 * The build runs unattended in GitHub Actions, so the log is the only thing
 * anyone reads when it goes wrong. Errors are summarised to the lines that
 * identify the failure rather than dumped whole — a Notion APIResponseError
 * carries the entire HTTP response, and printing it buries the one sentence
 * that says what happened under a screenful of headers and cookies.
 */

/** Notion API errors worth surfacing beyond the message itself. */
const describeApiError = (error) =>
  [
    error.code && `code: ${error.code}`,
    error.status && `status: ${error.status}`,
    error.request_id && `request_id: ${error.request_id}`,
  ].filter(Boolean);

/**
 * Renders an error as a short, indented block.
 *
 * @param {unknown} error
 * @returns {string}
 */
const formatError = (error) => {
  if (!(error instanceof Error)) {
    return `   ${String(error)}`;
  }

  const details = describeApiError(error);
  const stack = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .filter((line) => line.includes(process.cwd()))
    .slice(0, 3)
    .map((line) => `   ${line.trim()}`);

  return [
    `   ${error.message}`,
    details.length && `   (${details.join(", ")})`,
    ...stack,
  ]
    .filter(Boolean)
    .join("\n");
};

/** A non-fatal problem: the build carries on. */
const warn = (message, error) => {
  console.warn(`⚠️  ${message}`);
  if (error) console.warn(formatError(error));
};

/**
 * Reports a fatal problem and marks the process as failed.
 *
 * This sets `process.exitCode` instead of calling `process.exit()` so buffered
 * stdout is flushed before Node exits — `process.exit()` can truncate the log
 * when output is piped, which is precisely when you need to read it. The
 * caller is responsible for returning immediately after calling this.
 *
 * @param {string} message
 * @param {unknown} [error]
 */
const fail = (message, error) => {
  console.error(`❌ ERROR: ${message}`);
  if (error) console.error(formatError(error));
  process.exitCode = 1;
};

export { fail, warn, formatError };
