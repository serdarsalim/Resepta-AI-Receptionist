/*
 * Resepta booking embed. Put this where the calendar should appear on your
 * website:
 *
 *   <div data-resepta-booking="https://resepta.xyz/book/your-business"></div>
 *   <script src="https://resepta.xyz/embed.js" async></script>
 *
 * The booking page opens inside the div in your website's language (its
 * <html lang>, or data-lang on the div) when that is Turkish, English or
 * German. It is 720px tall unless the div says otherwise (data-height="800").
 * The div receives DOM events:
 *   resepta:ready   the booking page has loaded
 *   resepta:booked  detail: { start, end, durationMinutes, order }
 *                   (epoch milliseconds; never the customer's name, phone,
 *                   email or note)
 *
 * Plain JS, no dependencies. The page side of this contract: src/lib/embed.ts.
 */
(function () {
  "use strict";
  if (window.__reseptaBooking) {
    window.__reseptaBooking.scan();
    return;
  }

  var ATTR = "data-resepta-booking";
  var LANGS = ["tr", "en", "de"];
  var BOOKED_FIELDS = ["start", "end", "durationMinutes", "order"];
  var mounted = [];

  function websiteLanguage(el) {
    var raw = el.getAttribute("data-lang") || document.documentElement.lang || "";
    var code = raw.slice(0, 2).toLowerCase();
    return LANGS.indexOf(code) >= 0 ? code : "";
  }

  function mount(el) {
    if (el.__reseptaFrame) return;
    var src = el.getAttribute(ATTR);
    if (!src) return;
    var url;
    try {
      url = new URL(src, window.location.href);
    } catch {
      return;
    }
    // A booking page and nothing else: /book/<slug>, framed through its
    // /embed route, the one the app lets a website frame.
    var match = /^\/book\/([^/]+)\/?(?:embed\/?)?$/.exec(url.pathname);
    if (!match) return;
    url.pathname = "/book/" + match[1] + "/embed";
    url.search = "";
    var lang = websiteLanguage(el);
    if (lang) url.searchParams.set("lang", lang);

    var frame = document.createElement("iframe");
    frame.src = url.toString();
    frame.title = el.getAttribute("data-title") || "Book an appointment";
    frame.setAttribute("loading", "lazy");
    frame.style.cssText =
      "display:block;width:100%;border:0;height:" +
      (parseInt(el.getAttribute("data-height"), 10) || 720) +
      "px";
    el.__reseptaFrame = { frame: frame, origin: url.origin };
    mounted.push(el);
    el.appendChild(frame);
  }

  window.addEventListener("message", function (e) {
    var data = e.data;
    if (!data || typeof data.type !== "string" || data.type.indexOf("resepta:") !== 0) return;
    for (var i = 0; i < mounted.length; i++) {
      var el = mounted[i];
      var info = el.__reseptaFrame;
      if (e.source !== info.frame.contentWindow || e.origin !== info.origin) continue;
      if (data.type === "resepta:ready" || data.type === "resepta:booked") {
        var detail = {};
        if (data.type === "resepta:booked") {
          for (var j = 0; j < BOOKED_FIELDS.length; j++) detail[BOOKED_FIELDS[j]] = data[BOOKED_FIELDS[j]];
        }
        el.dispatchEvent(new CustomEvent(data.type, { detail: detail, bubbles: true }));
      }
      return;
    }
  });

  function scan() {
    var els = document.querySelectorAll("[" + ATTR + "]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  window.__reseptaBooking = { scan: scan };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
