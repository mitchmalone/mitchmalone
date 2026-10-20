import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

import { decodeFeed, fetchArticles } from "../helpers/feed.js";

const rss = (items, prolog = '<?xml version="1.0" encoding="UTF-8"?>') =>
  `${prolog}<rss version="2.0"><channel><title>Blog</title>${items
    .map(
      ({ title, link }) =>
        `<item>${title === undefined ? "" : `<title>${title}</title>`}${
          link === undefined ? "" : `<link>${link}</link>`
        }</item>`,
    )
    .join("")}</channel></rss>`;

/** Routes keyed by path: (req, res) => void. */
const routes = {
  "/utf8": (req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
    });
    res.end(rss([{ title: "Café “quotes”", link: "https://example.com/a" }]));
  },
  "/latin1-header": (req, res) => {
    res.writeHead(200, { "Content-Type": "text/xml; charset=ISO-8859-1" });
    res.end(
      Buffer.from(
        rss(
          [{ title: "Café déjà vu", link: "https://example.com/a" }],
          '<?xml version="1.0"?>',
        ),
        "latin1",
      ),
    );
  },
  "/latin1-prolog": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(
      Buffer.from(
        rss(
          [{ title: "Café", link: "https://example.com/a" }],
          '<?xml version="1.0" encoding="ISO-8859-1"?>',
        ),
        "latin1",
      ),
    );
  },
  "/messy": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end(
      rss([
        { link: "https://example.com/untitled" },
        { title: "No link" },
        { title: "**Bold** post", link: "https://example.com/1" },
        ...Array.from({ length: 10 }, (_, i) => ({
          title: `Post ${i + 2}`,
          link: `https://example.com/${i + 2}`,
        })),
      ]),
    );
  },
  "/html": (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Just a moment...</title>");
  },
  "/error": (req, res) => {
    res.writeHead(503);
    res.end();
  },
  "/slow": () => {
    // Never responds.
  },
  "/redirect": (req, res) => {
    res.writeHead(301, { Location: "/utf8" });
    res.end("moved");
  },
  "/headers": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end(
      rss([{ title: req.headers.accept, link: req.headers["user-agent"] }]),
    );
  },
};

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => routes[req.url](req, res));
  // Long keep-alive mirrors a CDN that holds idle connections open.
  server.keepAliveTimeout = 60_000;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.closeAllConnections() || server.close());

const get = (path, options = {}) =>
  fetchArticles(`${base}${path}`, { limit: 6, timeoutMs: 2000, ...options });

describe("fetchArticles", () => {
  test("parses a UTF-8 feed", async () => {
    assert.deepEqual(await get("/utf8"), [
      { title: "Café “quotes”", link: "https://example.com/a" },
    ]);
  });

  test("decodes using the Content-Type charset", async () => {
    const [article] = await get("/latin1-header");
    assert.equal(article.title, "Café déjà vu");
  });

  test("falls back to the XML prolog encoding", async () => {
    const [article] = await get("/latin1-prolog");
    assert.equal(article.title, "Café");
  });

  test("skips items without a title or link, strips asterisks, applies the limit", async () => {
    const articles = await get("/messy");
    assert.equal(articles.length, 6);
    assert.deepEqual(articles[0], {
      title: "Bold post",
      link: "https://example.com/1",
    });
    assert.ok(articles.every((a) => a.title && a.link));
  });

  test("follows redirects", async () => {
    const [article] = await get("/redirect");
    assert.equal(article.title, "Café “quotes”");
  });

  test("sends feed-friendly Accept and its own User-Agent", async () => {
    const [{ title: accept, link: userAgent }] = await get("/headers");
    assert.match(accept, /application\/rss\+xml/);
    assert.match(accept, /text\/xml/);
    assert.match(userAgent, /^mitchmalone-readme/);
  });

  test("rejects a 200 HTML page with a clear message", async () => {
    await assert.rejects(get("/html"), /returned text\/html.*not a feed/);
  });

  test("rejects a non-2xx status", async () => {
    await assert.rejects(get("/error"), /failed with status 503/);
  });

  test("names the feed when the request times out", async () => {
    await assert.rejects(
      get("/slow", { timeoutMs: 200 }),
      new RegExp(`Blog feed request to ${base}/slow timed out after 200ms`),
    );
  });

  test("names the feed when the connection fails", async () => {
    await assert.rejects(
      fetchArticles("http://127.0.0.1:1/feed", { limit: 6, timeoutMs: 2000 }),
      /Blog feed request to http:\/\/127\.0\.0\.1:1\/feed failed: /,
    );
  });

  test("does not hold the process open after a redirected fetch", async () => {
    // The original bug: the build finished but Node never exited. Run the
    // fetch in a child against this keep-alive server and time its exit.
    const script = `
      import { fetchArticles } from ${JSON.stringify(
        new URL("../helpers/feed.js", import.meta.url).href,
      )};
      await fetchArticles(${JSON.stringify(
        `${base}/redirect`,
      )}, { limit: 6, timeoutMs: 2000 });
    `;
    const started = Date.now();
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script],
        { stdio: "inherit" },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("child process still running after 10s"));
      }, 10_000);
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 5000, "child should exit promptly");
  });
});

describe("decodeFeed", () => {
  const latin1 = (text) => new Uint8Array(Buffer.from(text, "latin1")).buffer;

  test("defaults to UTF-8", () => {
    const body = new TextEncoder().encode("<rss>é</rss>").buffer;
    assert.equal(decodeFeed(body, null), "<rss>é</rss>");
  });

  test("prefers the header over the prolog", () => {
    const body = latin1('<?xml version="1.0" encoding="UTF-8"?><rss>é</rss>');
    assert.match(decodeFeed(body, 'text/xml; charset="iso-8859-1"'), /é/);
  });

  test("falls back to UTF-8 on an unknown charset label", () => {
    const body = new TextEncoder().encode("<rss>é</rss>").buffer;
    assert.equal(decodeFeed(body, "text/xml; charset=bogus"), "<rss>é</rss>");
  });
});
