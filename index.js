import fs from "fs/promises";
import vm from "node:vm";
import Parser from "rss-parser";
import { Client, LogLevel } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";

import { fail, warn } from "./helpers/errorHelpers.js";

import "dotenv/config";

/**
 * Sources. The bio prose lives on a Notion page; projects and links live in
 * Notion databases. Blog posts still come from the site's own RSS feed.
 */
const BLOG_FEED = "https://mitchmalone.io/feeds/rss.xml";
const BIO_PAGE_ID = "3bb3d7d179ad80a7af81d864b5cca6e8";

/**
 * Data source (collection) IDs rather than database IDs — since API version
 * 2025-09-03 a database is a container for one or more data sources, and
 * queries run against the source. Re-created a database? Re-fetch its ID.
 */
const PROJECTS_DATA_SOURCE = "3b63d7d1-79ad-80e6-9ef3-000bb0fdf19a";
const LINKS_DATA_SOURCE = "3bb3d7d1-79ad-809f-97a2-000bb6fa08ec";

/** Blog posts shown in the README. */
const MAX_ARTICLES = 6;

/**
 * Per-request ceiling. The build runs unattended, so a stalled connection
 * would otherwise hang the job until the runner's own timeout hours later.
 */
const REQUEST_TIMEOUT_MS = 15000;

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: "2025-09-03",
  timeoutMs: REQUEST_TIMEOUT_MS,
  // The SDK logs every failed request at warn level, so a single outage
  // prints once per query on top of the error we raise ourselves.
  logLevel: LogLevel.ERROR,
});

/**
 * Whole years elapsed between two dates, decrementing when the anniversary
 * hasn't landed yet this year. `to` defaults to today, so this ages on its
 * own — the reason the bio stores anchor dates instead of numbers.
 *
 * Dates are compared part-by-part rather than via Date arithmetic so the
 * result never shifts by a day depending on the runner's timezone.
 *
 * @param {string} from - Anchor date as "YYYY-MM-DD".
 * @param {string} [to] - End date as "YYYY-MM-DD". Omit for "until now".
 * @returns {number}
 */
function years(from, to = null) {
  const parse = (value, label) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      // Bare 2001-02-15 in a template is subtraction, not a date, and would
      // otherwise resolve to a plausible-looking wrong number. Fail loudly.
      throw new Error(
        `years() needs a quoted "YYYY-MM-DD" ${label}, got ${JSON.stringify(value)}`,
      );
    }
    return value.split("-").map(Number);
  };

  const [fromYear, fromMonth, fromDay] = parse(from, "start date");
  const [toYear, toMonth, toDay] = to
    ? parse(to, "end date")
    : (() => {
        const now = new Date();
        return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
      })();

  let elapsed = toYear - fromYear;
  if (toMonth < fromMonth || (toMonth === fromMonth && toDay < fromDay)) {
    elapsed--;
  }

  return elapsed;
}

/**
 * Evaluates {{ ... }} expressions in the bio markdown.
 *
 * Expressions run through node:vm against a context holding only `years` and
 * a few JS built-ins, so `process` and `require` aren't reachable from text
 * typed into Notion. This is a guardrail against mistakes, not a security
 * boundary — keep the bio page shared with people you'd trust with a deploy
 * key.
 *
 * A failing expression is left visible in the output rather than throwing, so
 * a typo shows up as `{{...}}` in the README instead of a wrong number.
 */
function renderExpressions(markdown) {
  const context = vm.createContext({ years, Date, Math, Number });

  // Notion escapes literal braces when serialising to markdown.
  const unescaped = markdown.replace(/\\([{}])/g, "$1");

  return unescaped.replace(/\{\{([\s\S]+?)\}\}/g, (match, expression) => {
    // Notion's editor curls quotes as you type, which JS won't parse. Only
    // the expression is normalised — apostrophes in the prose stay as typed.
    const source = expression
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');

    try {
      return String(vm.runInContext(source, context, { timeout: 100 }));
    } catch (error) {
      warn(`Bad expression ${match.trim()} — ${error.message}`);
      return match;
    }
  });
}

/** Notion property readers, keyed to the shapes the REST API returns. */
const readTitle = (property) =>
  (property?.title ?? []).map((part) => part.plain_text).join("");
const readText = (property) =>
  (property?.rich_text ?? []).map((part) => part.plain_text).join("") || null;
const readUrl = (property) => property?.url ?? null;
const readSelect = (property) => property?.select?.name ?? null;
const readNumber = (property) => property?.number ?? null;

/** Sort Order ascending with unset values last, then alphabetically by name. */
const byOrderThenName = (a, b) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
  a.title.localeCompare(b.title);

/**
 * Fetches the bio page and converts it to markdown, expressions resolved.
 */
async function getBio() {
  console.log(`🐶 Attempting to fetch bio from Notion page ${BIO_PAGE_ID}`);

  const n2m = new NotionToMarkdown({ notionClient: notion });
  const blocks = await n2m.pageToMarkdown(BIO_PAGE_ID);
  const markdown = n2m.toMarkdownString(blocks).parent ?? "";

  if (!markdown.trim()) {
    throw new Error("Notion bio page returned no content");
  }

  console.log(`✅ Success! Bio fetched (${markdown.length} characters).`);

  // notion-to-md ends each block with its own blank line, which doubles up
  // once the blocks are joined — collapse back to one blank line between
  // paragraphs so the markdown reads the way it does in Notion.
  return renderExpressions(markdown).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Fetches projects for the shipping board.
 */
async function getProjects() {
  console.log(`🐶 Attempting to fetch projects from Notion`);

  const { results } = await notion.dataSources.query({
    data_source_id: PROJECTS_DATA_SOURCE,
    sorts: [{ property: "Sort Order", direction: "ascending" }],
  });

  const projects = results
    .map(({ properties }) => ({
      title: readTitle(properties.Name),
      url: readUrl(properties.URL),
      description: readText(properties.Description),
      status: readSelect(properties.Status)?.toLowerCase() ?? null,
      version: readText(properties.Version),
      order: readNumber(properties["Sort Order"]),
    }))
    .filter((project) => project.title)
    .sort(byOrderThenName);

  console.log(`✅ Success! ${projects.length} projects fetched.`);
  return projects;
}

/**
 * Fetches links, honouring the Published checkbox — an unchecked row stays
 * out of the public README.
 */
async function getLinks() {
  console.log(`🐶 Attempting to fetch links from Notion`);

  const { results } = await notion.dataSources.query({
    data_source_id: LINKS_DATA_SOURCE,
    filter: { property: "Published", checkbox: { equals: true } },
    sorts: [{ property: "Order", direction: "ascending" }],
  });

  const links = results
    .map(({ properties }) => ({
      title: readTitle(properties.Name),
      url: readUrl(properties.URL),
      emoji: readText(properties.Emoji),
      order: readNumber(properties.Order),
    }))
    .filter((link) => link.title && link.url)
    .sort(byOrderThenName);

  console.log(`✅ Success! ${links.length} links fetched.`);
  return links;
}

/**
 * Fetches the latest blog posts.
 */
async function getArticles() {
  console.log(`🐶 Attempting to fetch blog data from ${BLOG_FEED}`);

  const feed = await new Parser({ timeout: REQUEST_TIMEOUT_MS }).parseURL(
    BLOG_FEED,
  );
  const articles = feed.items.slice(0, MAX_ARTICLES).map((article) => ({
    title: article.title.replaceAll("*", ""),
    link: article.link,
  }));

  console.log(`✅ Success! ${articles.length} articles fetched.`);
  return articles;
}

/** Escapes pipes so a description can't break out of a table cell. */
const cell = (value) => (value ?? "").replaceAll("|", "\\|");

/** Renders the projects table, status and version sharing a column. */
function projectsTable(projects) {
  const rows = projects.map((project) => {
    const name = project.url
      ? `[${project.title}](${project.url})`
      : project.title;
    const status = [
      project.status ? `\`${project.status}\`` : "",
      project.version ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return `| ${cell(name)} | ${cell(project.description)} | ${status} |`;
  });

  return ["| Project | What it is | Status |", "|---|---|---|", ...rows].join(
    "\n",
  );
}

/**
 * Assembles README.md from the fetched pieces.
 */
async function generateReadMe({ bio, projects, links, articles }) {
  console.log(`⚙️ Generating README.md file.`);

  const refreshDate = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZoneName: "short",
    timeZone: "Australia/Hobart",
  });

  const sections = [
    `# Hi, I'm Mitch! 👋`,
    bio,
    projects.length && `### 🎒 Projects\n\n${projectsTable(projects)}`,
    articles.length &&
      `### ✍️ Latest Blog Posts\n\n${articles
        .map((article) => `- [${article.title}](${article.link})`)
        .join("\n")}`,
    links.length &&
      `### 🔗 My links\n\n${links
        .map((link) => `- **${link.emoji ?? "🔗"} [${link.title}](${link.url})**`)
        .join("\n")}`,
    `Github profile automatically generates every 3 hours. Articles, and data marked in \`code\` is generated by the Github\nAction. Make your own by inspecting this repository.`,
    `Last generation: \`${refreshDate}\`.`,
  ].filter(Boolean);

  await fs.writeFile("README.md", `${sections.join("\n\n")}\n`);
  console.log(`✅ Success! README.md file generated.`);
}

/**
 * Everything is fetched before anything is written, so a Notion outage or a
 * bad response leaves the previously committed README.md untouched — git is
 * the fallback copy now that user.json is gone. Stale beats blank.
 */
async function action() {
  if (!process.env.NOTION_TOKEN) {
    return fail("NOTION_TOKEN is not set");
  }

  try {
    const [bio, projects, links, articles] = await Promise.all([
      getBio(),
      getProjects(),
      getLinks(),
      getArticles(),
    ]);

    await generateReadMe({ bio, projects, links, articles });
  } catch (error) {
    fail("Failed to build README.md — leaving the existing one in place", error);
  }
}

action();
