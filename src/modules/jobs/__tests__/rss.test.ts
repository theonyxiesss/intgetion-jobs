import { describe, expect, it } from "vitest";
import { buildRss, escapeXml } from "../service/rss";

const channel = {
  title: "Remote jobs",
  description: "Newest jobs",
  siteUrl: "https://example.com",
  locale: "en",
};

describe("RSS feed (D204)", () => {
  it("escapes markup and drops invalid control characters", () => {
    expect(escapeXml(`<b>"A&B"</b>'\u0007`)).toBe(
      "&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;&apos;",
    );
  });

  it("builds one item per job with link, date and categories", () => {
    const xml = buildRss(channel, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Solidity <engineer>",
        companyName: "Acme & Co",
        publishedAt: "2026-10-04T12:00:00.000Z",
        salary: "5,000 – 7,000 USD / month",
        categories: ["Engineering"],
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        title: "Writer",
        companyName: "Beta",
        publishedAt: null,
        salary: null,
        categories: [],
      },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain(
      "<title>Solidity &lt;engineer&gt; — Acme &amp; Co</title>",
    );
    expect(xml).toContain(
      "<link>https://example.com/jobs/00000000-0000-4000-8000-000000000001</link>",
    );
    expect(xml).toContain("<pubDate>Sun, 04 Oct 2026 12:00:00 GMT</pubDate>");
    expect(xml).toContain("<category>Engineering</category>");
    expect(xml).toContain("<description>Beta</description>");
    expect(xml).toContain(
      '<atom:link href="https://example.com/jobs/rss.xml" rel="self"',
    );
  });
});
