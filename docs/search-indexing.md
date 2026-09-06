# Search indexing

OddsFront exposes a crawler-facing URL for every published translation. English
uses `/news/...`; the other languages use `/{locale}/news/...`, including
`/pt-br/news/...`. Each page publishes a self-canonical URL, reciprocal
`hreflang` entries, `x-default`, localized Open Graph/Twitter metadata, and
`NewsArticle` structured data with a 1200x630 article image.

Discovery endpoints:

- `/robots.txt` allows public pages, excludes API and preview routes, and lists
  both sitemap endpoints.
- `/sitemap.xml` is a sitemap index. `/sitemaps/core.xml` contains stable and
  country pages; `/sitemaps/articles-N.xml` contains at most 200 articles per
  part and therefore remains below sitemap URL and byte limits as the archive
  grows.
- `/news-sitemap.xml` contains translated editions published within the last 48
  hours for Google News discovery.
- `/news/rss.xml` exposes the current English edition.
- `/<indexnow-key>.txt` proves the IndexNow key. `npm run news:indexnow` submits
  current public URLs to the shared IndexNow endpoint used by Bing, Yandex, and
  participating search engines.

The news systemd service runs publication, offline translation, and IndexNow in
that order. Google Search Console and Yandex Webmaster should both receive
`https://oddsfront.com/sitemap.xml`; Google can additionally receive
`https://oddsfront.com/news-sitemap.xml`. Console ownership tokens remain in the
provider or DNS configuration and never enter Git.

Production verification:

```bash
curl -fsS https://oddsfront.com/robots.txt
curl -fsS https://oddsfront.com/sitemap.xml
curl -fsS https://oddsfront.com/sitemaps/core.xml
curl -fsS https://oddsfront.com/sitemaps/articles-1.xml
curl -fsS https://oddsfront.com/news-sitemap.xml
npm run news:indexnow
```
