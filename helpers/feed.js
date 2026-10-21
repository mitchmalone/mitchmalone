/**
 * Blog feed fetching for the README build.
 *
 * Kept apart from index.js so it can be exercised against a local server
 * without a Notion token or network access.
 */

import Parser from "rss-parser";

const HEADERS = {
  "User-Agent":
    "mitchmalone-readme (+https://github.com/mitchmalone/mitchmalone)",
  Accept:
    "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
};

/**
 * Decodes a feed body using the charset it declares — the Content-Type
 * header first, then the XML prolog — rather than assuming UTF-8, so a
 * Latin-1 feed doesn't turn curly quotes in titles into replacement
 * characters.
 *
 * @param {ArrayBuffer} body
 * @param {string | null} contentType
 * @returns {string}
 */
function decodeFeed(body, contentType) {
  const bytes = new Uint8Array(body);
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  // The prolog is ASCII whatever the encoding, so latin1 reads it safely.
  const prolog = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const fromProlog = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(
    prolog,
  )?.[1];

  const charset = fromHeader ?? fromProlog ?? "utf-8";

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Unknown label — UTF-8 is still the most likely right answer.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Fetches a feed and returns its latest posts as { title, link }.
 *
 * Uses fetch rather than rss-parser's parseURL(): parseURL() follows
 * redirects without reading the first response, which leaves its TLS socket
 * outside Node's free pool and holds the process open until the peer drops
 * it. fetch drains redirects and doesn't keep the event loop alive.
 *
 * @param {string} url
 * @param {{ limit: number, timeoutMs: number }} options
 * @returns {Promise<{ title: string, link: string }[]>}
 */
async function fetchArticles(url, { limit, timeoutMs }) {
  let response;
  try {
    response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A bare DOMException says nothing about which of the parallel requests
    // stalled, and its stack is all undici frames.
    const reason =
      error.name === "TimeoutError"
        ? `timed out after ${timeoutMs}ms`
        : `failed: ${error.cause?.message ?? error.message}`;
    throw new Error(`Blog feed request to ${url} ${reason}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      `Blog feed request to ${url} failed with status ${response.status}`,
    );
  }

  // A CDN challenge or soft 404 comes back 200 with an HTML page, which
  // would otherwise surface as an opaque XML parse error.
  const contentType = response.headers.get("content-type");
  if (contentType && !/xml/i.test(contentType)) {
    throw new Error(
      `Blog feed at ${url} returned ${contentType}, not a feed — has the URL moved?`,
    );
  }

  const xml = decodeFeed(await response.arrayBuffer(), contentType);
  const feed = await new Parser().parseString(xml);

  return (
    feed.items
      .map((item) => ({
        title: (item.title ?? "").replaceAll("*", "").trim(),
        link: item.link,
      }))
      // An untitled draft or a link-less item would render as a broken bullet.
      .filter((article) => article.title && article.link)
      .slice(0, limit)
  );
}

export { decodeFeed, fetchArticles };
