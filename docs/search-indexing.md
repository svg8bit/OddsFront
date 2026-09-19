# Search indexing

OddsFront publishes one canonical origin: `https://oddsfront.com`. The legacy
duplicate `/global-conflict-map` permanently redirects to `/`; the map UI and
rendering remain unchanged. Every public news translation has a self-canonical
URL, reciprocal `hreflang` entries, `x-default`, localized social metadata, and
`NewsArticle` structured data.

## Discovery endpoints

- `/robots.txt` allows public pages, excludes APIs and the preview route, and
  advertises both sitemap indexes.
- `/sitemap.xml` links to `/sitemaps/core.xml` and bounded article sitemap
  parts. Withdrawn articles are excluded. The core sitemap includes the
  crawlable news archive, archive pagination, and the newsdesk page.
- General sitemaps list one high-value English `<loc>` per article, listing,
  topic and country page, with every complete localized version attached as a
  reciprocal `hreflang` alternate. HTML pages retain the same reciprocal links.
  This keeps the submitted crawl inventory focused instead of multiplying it by
  every language, while search engines can still discover and serve each locale.
- `/news-sitemap.xml` is the Google News sitemap index. It splits the last 48
  hours by language and then into parts of no more than 1,000 news URLs under
  `/news-sitemaps/{locale}-{part}.xml`. Simplified Chinese uses Google News's
  required `zh-cn` publication language.
- Every language has an RSS feed at `/{locale}/news/rss.xml` (English uses
  `/news/rss.xml`). Feeds advertise Google's WebSub hub; the publication
  follow-up notifies the hub after a completed edition.
- `/<indexnow-key>.txt` proves the IndexNow key. `npm run news:indexnow` sends
  only added, updated, or removed article URLs and the listing pages affected
  by those changes. It retains a private `indexnow-state.json`, writes it only
  after all batches are accepted, and never silently discards URLs above the
  10,000-URL request limit.

IndexNow currently distributes a shared submission to Bing, Yandex, Seznam,
Naver, Yep, Internet Archive, and Amazonbot. Google does not consume IndexNow;
Google discovery comes from crawlable links, sitemap indexes, and Google News
sitemaps. RSS/WebSub is an additional syndication signal for feed subscribers,
not a Google Search submission API.

## Webmaster-console setup

Use only the canonical `oddsfront.com` property. The checked-in Google HTML
verification file can verify a URL-prefix property, while a Google Domain
property should be verified in DNS. Optional provider verification codes can
be supplied at build time without changing source:

- `ODDSFRONT_GOOGLE_SITE_VERIFICATION`
- `ODDSFRONT_BING_SITE_VERIFICATION`
- `ODDSFRONT_YANDEX_SITE_VERIFICATION`
- `ODDSFRONT_NAVER_SITE_VERIFICATION`
- `ODDSFRONT_BAIDU_SITE_VERIFICATION`

After ownership is verified:

1. Google Search Console: submit both `https://oddsfront.com/sitemap.xml` and
   `https://oddsfront.com/news-sitemap.xml`. Inspect `/`, `/news`, and a recent
   `/en/news/{slug}`. Check the Pages report, manual actions, security issues,
   and whether the selected property is the canonical non-`www` domain.
2. Bing Webmaster Tools: import the verified Google property or verify the
   canonical host, submit `/sitemap.xml`, and inspect the IndexNow report.
3. Yandex Webmaster: verify the host, submit `/sitemap.xml`, and inspect
   indexing diagnostics. IndexNow remains the fast-change signal.
4. Naver Search Advisor: verify the canonical host and monitor IndexNow
   receipts. Seznam, Yep, Internet Archive, and Amazonbot need no additional
   OddsFront endpoint beyond the shared IndexNow submission.
5. Baidu Search Resource Platform: verify the canonical host and submit
   `/sitemaps/core.xml` plus each current `/sitemaps/articles-N.xml` directly.
   Its current guidance does not process sitemap-index files. Baidu's private
   API push token and property-specific quota must stay outside Git.

A verification file or an HTTP 200 IndexNow receipt proves only ownership or
delivery. It does not guarantee selection for indexing or search impressions.

## Operations

The news service runs publication, offline translation, IndexNow, and WebSub in
that order. Russian remains first for its editorial review; the other languages
are ordered by their real translation backlog. Each language finishes the
newest complete articles within a bounded text budget before using spare work
on the archive or map dictionary, so a timeout cannot repeatedly starve the
same locales. The first IndexNow run after this migration deliberately
establishes a full snapshot; later runs are deltas. Force a reviewed rebuild
only when the provider asks for one:

```bash
npm run news:indexnow -- --dry-run
npm run news:indexnow -- --full
npm run news:websub -- --dry-run
```

Production verification:

```bash
curl -fsS https://oddsfront.com/robots.txt
curl -fsS https://oddsfront.com/sitemap.xml
curl -fsS https://oddsfront.com/sitemaps/core.xml
curl -fsS https://oddsfront.com/sitemaps/articles-1.xml
curl -fsS https://oddsfront.com/news-sitemap.xml
curl -fsS https://oddsfront.com/news-sitemaps/en-1.xml
curl -fsS https://oddsfront.com/news/rss.xml
```
