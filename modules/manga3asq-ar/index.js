"use strict";
/*
 * Independent community source for publicly accessible 3asq.online pages.
 * Synthetiq Books contract v1; no authentication, circumvention, or downloaded code.
 * Endpoint/layout references are described in README.md; iOS installation is UNTESTED.
 */
(() => {
  const BASE = "https://3asq.online";
  const HOST = "3asq.online";
  const CARDS_PER_PAGE = 21;
  const HTML_HEADERS = { Accept: "text/html,application/xhtml+xml", Referer: BASE + "/" };

  function decodeHTML(s) {
    const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘" };
    return String(s ?? "")
      .replace(/&#x([0-9a-f]+);/gi, (_, v) => String.fromCodePoint(parseInt(v, 16)))
      .replace(/&#(\d+);/g, (_, v) => String.fromCodePoint(parseInt(v, 10)))
      .replace(/&([a-z][a-z0-9]+);/gi, (v, k) => Object.prototype.hasOwnProperty.call(named, k.toLowerCase()) ? named[k.toLowerCase()] : v);
  }
  function text(s) {
    return decodeHTML(String(s ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }
  function attr(tag, name) {
    const m = String(tag).match(new RegExp("(?:^|\\s)" + name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
    return decodeHTML(m ? (m[1] ?? m[2] ?? m[3] ?? "") : "").trim();
  }
  function safeURL(value) {
    const candidate = decodeHTML(value).trim();
    if (!candidate || /^(?:data|javascript|blob|file):/i.test(candidate)) return "";
    try {
      const u = new URL(candidate, BASE + "/");
      return u.protocol === "https:" && u.hostname.toLowerCase() === HOST && !u.username && !u.password ? u.href : "";
    } catch (_) { return ""; }
  }
  function mangaURL(id) {
    const input = String(id || "").trim();
    const candidate = /^[a-z0-9][a-z0-9._%-]*$/i.test(input) ? BASE + "/manga/" + input + "/" : input;
    const url = safeURL(candidate);
    if (!url) throw new Error("3asq: invalid series URL");
    const u = new URL(url);
    const m = u.pathname.match(/^\/manga\/([^/]+)\/?$/i);
    if (!m) throw new Error("3asq: invalid series identity");
    return BASE + "/manga/" + m[1] + "/";
  }
  function chapterURL(id) {
    const input = String(id || "").trim();
    const candidate = /^[a-z0-9._%-]+\/[a-z0-9._%-]+$/i.test(input) ? BASE + "/manga/" + input + "/" : input;
    const url = safeURL(candidate);
    if (!url) throw new Error("3asq: invalid chapter URL");
    const u = new URL(url);
    if (!/^\/manga\/[^/]+\/[^/]+\/?$/i.test(u.pathname)) throw new Error("3asq: invalid chapter identity");
    return BASE + (u.pathname.endsWith("/") ? u.pathname : u.pathname + "/");
  }
  function blocked(body) {
    return /<title>\s*(?:just a moment|access denied|attention required|403 forbidden)/i.test(body)
      || /cf-chl-|challenge-platform|captcha-container|verify you are human|enable javascript and cookies to continue|checking your browser/i.test(body);
  }
  async function getHTML(url, method = "GET") {
    if (typeof globalThis.fetchv2 !== "function") throw new Error("3asq: Books fetchv2 bridge is unavailable");
    const target = safeURL(url);
    if (!target) throw new Error("3asq: request outside allowed HTTPS host");
    const headers = { ...HTML_HEADERS };
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      headers["X-Requested-With"] = "XMLHttpRequest";
    }
    // Synthetiq's fetchv2 positional bridge: (url, headers, method, body, options)
    const res = await globalThis.fetchv2(target, headers, method, method === "POST" ? "" : null,
      { followRedirects: true, maxBytesHint: 8 * 1024 * 1024, responseClass: "html" });
    const status = Number(res && res.status);
    if (!res || res.ok === false || (status && (status < 200 || status >= 300))) {
      throw new Error("3asq: HTTP " + (status || "network error"));
    }
    if (res.bodyDropped) throw new Error("3asq: source response exceeded safety limits");
    if (res.finalUrl && !safeURL(res.finalUrl)) throw new Error("3asq: redirected outside allowed host");
    const body = typeof res.text === "function" ? await res.text() : res.body;
    if (typeof body !== "string" || !body.trim()) throw new Error("3asq: empty response");
    if (blocked(body)) throw new Error("3asq: website verification / access challenge; open website normally");
    return body;
  }
  // Balanced extraction of one HTML element by tag; copes with nested DIVs/LI tags.
  // It deliberately does not execute page scripts or read unrelated document areas.
  function endOfElement(html, start, tag) {
    const pattern = new RegExp("<\\/?" + tag + "\\b[^>]*>", "gi");
    pattern.lastIndex = start;
    let depth = 0; let m;
    while ((m = pattern.exec(html))) {
      if (/^<\//.test(m[0])) depth--;
      else if (!/\/\s*>$/.test(m[0])) depth++;
      if (depth === 0) return pattern.lastIndex;
    }
    return -1;
  }
  function elementsWithClass(html, tag, cls, limit = 2000) {
    const result = [];
    const rx = new RegExp("<" + tag + "\\b[^>]*>", "gi");
    let m;
    while ((m = rx.exec(html)) && result.length < limit) {
      if (!(" " + attr(m[0], "class") + " ").includes(" " + cls + " ")) continue;
      const end = endOfElement(html, m.index, tag);
      if (end < 0) continue;
      result.push(html.slice(m.index, end));
      rx.lastIndex = end;
    }
    return result;
  }
  function firstClass(html, cls, tags = ["div", "section", "h1", "h2", "h3"]) {
    for (const tag of tags) {
      const found = elementsWithClass(html, tag, cls, 1);
      if (found.length) return found[0];
    }
    return "";
  }
  function anchors(html) {
    const out = [];
    const rx = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = rx.exec(html))) {
      out.push({ href: safeURL(attr(m[0].slice(0, m[0].indexOf(">") + 1), "href")), title: text(m[2]), raw: m[0] });
    }
    return out;
  }
  function images(html) {
    return (html.match(/<img\b[^>]*>/gi) || []).map(tag => {
      const source = attr(tag, "data-src") || attr(tag, "data-lazy-src") || attr(tag, "data-original") || attr(tag, "src");
      return safeURL(source);
    }).filter(Boolean);
  }
  function seriesLink(html) {
    // Filter /manga/ links to avoid translator badge links, chapters, and recommendations.
    return anchors(html).find(a => a.href && /^\/manga\/[^/]+\/?$/.test(new URL(a.href).pathname) && a.title) || null;
  }
  function parseCards(html, search = false) {
    let cards = elementsWithClass(html, "div", search ? "c-tabs-item__content" : "page-item-detail");
    if (!cards.length) cards = elementsWithClass(html, "div", search ? "page-item-detail" : "c-tabs-item__content");
    const out = []; const seen = new Set();
    for (const card of cards) {
      const titled = firstClass(card, "post-title", ["h3", "h4", "div", "h2"]);
      const a = seriesLink(titled) || seriesLink(card);
      if (!a || seen.has(a.href)) continue;
      const coverBlock = firstClass(card, "item-thumb") || firstClass(card, "tab-thumb") || card;
      const image = images(coverBlock)[0] || "";
      out.push({ id: a.href, href: a.href, url: a.href, title: a.title, image, cover: image });
      seen.add(a.href);
    }
    return out;
  }
  function hasNextPage(html, page, itemCount) {
    const next = Math.max(1, Number(page) || 1) + 1;
    const pager = firstClass(html, "wp-pagenavi") || firstClass(html, "pagination") || html;
    return new RegExp("(?:/page/" + next + "/|[?&]paged=" + next + "(?:[&\\\"']|$))", "i").test(pager)
      || (/class=["'][^"']*\bnext\b/i.test(pager) && itemCount >= CARDS_PER_PAGE);
  }
  function searchPath(query, page) {
    const n = Math.max(1, Math.min(1000, Math.floor(Number(page) || 1)));
    if (query === "__feed:latest" || query === "__feed:new") {
      const archive = n === 1 ? "/manga/" : "/manga/page/" + n + "/";
      return BASE + archive + "?m_orderby=" + (query === "__feed:new" ? "new-manga" : "latest");
    }
    const q = String(query || "").trim().slice(0, 160);
    if (!q) return BASE + "/manga/";
    return BASE + (n === 1 ? "/" : "/page/" + n + "/") + "?s=" + encodeURIComponent(q) + "&post_type=wp-manga";
  }
  async function searchResults(query, page = 1) {
    const feed = query === "__feed:latest" || query === "__feed:new";
    const html = await getHTML(searchPath(query, page));
    const items = parseCards(html, !feed);
    return { items, hasMore: hasNextPage(html, page, items.length) };
  }
  function metaRow(html, label) {
    for (const part of elementsWithClass(html, "div", "post-content_item")) {
      const heading = text(firstClass(part, "summary-heading"));
      if (!heading.includes(label)) continue;
      return text(firstClass(part, "summary-content"));
    }
    return "";
  }
  function parseDetails(html, id) {
    const titleSection = firstClass(html, "post-title");
    let title = text((titleSection.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
    title = title.replace(/^3asq\s+/i, "").trim();
    if (!title) title = text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
    if (!title) throw new Error("3asq: details title is missing");
    const cover = images(firstClass(html, "summary_image"))[0] || "";
    const description = text(firstClass(html, "summary__content") || firstClass(html, "manga-excerpt"));
    const author = metaRow(html, "الكاتب");
    const status = metaRow(html, "الحالة");
    return { id, href: id, url: id, title, image: cover, cover, description, author, authors: author ? [author] : [], status };
  }
  async function extractDetails(id) {
    const href = mangaURL(id);
    return parseDetails(await getHTML(href), href);
  }
  function parseChapters(html, series) {
    const owner = new URL(mangaURL(series)).pathname.toLowerCase();
    const seen = new Set(); const out = [];
    for (const li of elementsWithClass(html, "li", "wp-manga-chapter", 20000)) {
      const a = anchors(li).find(x => x.href && new URL(x.href).pathname.toLowerCase().startsWith(owner)
        && /^\/manga\/[^/]+\/[^/]+\/?$/i.test(new URL(x.href).pathname));
      if (!a) continue;
      const href = chapterURL(a.href);
      if (seen.has(href)) continue;
      const numberMatch = a.title.match(/(?:^|\b)(\d+(?:[.,]\d+)?)(?:\b|$)/);
      const dateArea = firstClass(li, "chapter-release-date", ["span", "div"]);
      const dateTag = (dateArea.match(/<a\b[^>]*>/i) || [])[0] || "";
      const releaseDate = attr(dateTag, "title") || text(firstClass(dateArea, "timediff", ["span", "time"])) || null;
      out.push({ id: href, href, url: href, title: a.title || href.split("/").filter(Boolean).pop(),
        number: numberMatch ? Number(numberMatch[1].replace(",", ".")) : null, releaseDate, language: "ar" });
      seen.add(href);
    }
    return out;
  }
  async function extractChapters(id) {
    const series = mangaURL(id);
    // Important: series HTML normally omits its full chapter list; this public
    // WordPress/Madara endpoint serves the complete list through POST.
    const ajax = series + "ajax/chapters/";
    const html = await getHTML(ajax, "POST");
    const chapters = parseChapters(html, series);
    if (!chapters.length) throw new Error("3asq: chapter list unavailable or layout changed");
    return chapters;
  }
  function parsePageImages(html) {
    const main = firstClass(html, "reading-content");
    if (!main) throw new Error("3asq: reading-content container missing");
    const seen = new Set(); const pages = [];
    for (const u of images(main)) {
      if (seen.has(u)) continue;
      if (/\.(?:svg|ico)(?:[?#]|$)/i.test(u) || /(?:placeholder|blank|loader|spinner)/i.test(u)) continue;
      pages.push({ url: u, headers: { Accept: "image/avif,image/webp,image/*,*/*", Referer: BASE + "/" } });
      seen.add(u);
    }
    return pages;
  }
  async function extractImages(chapterID) {
    const html = await getHTML(chapterURL(chapterID));
    const pages = parsePageImages(html);
    if (!pages.length) throw new Error("3asq: chapter has no accessible reading images");
    return pages;
  }
  async function discoveryHome() {
    const latest = await searchResults("__feed:latest", 1);
    const newlyAdded = await searchResults("__feed:new", 1);
    return { sections: [
      { id: "latest", title: "أحدث التحديثات", items: latest.items },
      { id: "new", title: "مانجا جديدة", items: newlyAdded.items }
    ] };
  }
  function discoveryFeed(feedID, page = 1) {
    return searchResults(String(feedID).toLowerCase() === "new" ? "__feed:new" : "__feed:latest", page);
  }
  const handlers = { searchResults, extractDetails, extractChapters, extractImages, discoveryHome, discoveryFeed };
  globalThis.SynthetiqModule = handlers;
  Object.assign(globalThis, handlers);
})();
