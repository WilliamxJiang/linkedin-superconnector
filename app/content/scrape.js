/**
 * Clean helper
 */
function clean(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * Normalize a LinkedIn profile href (handles relative "/in/..." links).
 */
function normalizeLinkedInUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href || null;
  }
}

/**
 * Heuristic to detect likely location strings.
 */
function isLikelyLocation(text) {
  const t = clean(text);
  if (!t) return false;
  if (t.length > 60) return false;
  if (/,/.test(t) && t.split(/\s+/).length <= 8) return true;
  const keywords = [
    "canada","united states","usa","uk","england","scotland","ireland",
    "ontario","quebec","bc","british columbia","alberta",
    "california","new york","texas","florida","toronto","vancouver","london",
    "montreal","waterloo","boston","san francisco","nyc","bay area"
  ];
  const low = t.toLowerCase();
  return keywords.some(k => low.includes(k));
}

/**
 * Find all DOM elements whose text matches a keyword.
 * Returns exact matches first; if none, returns partial matches.
 */
function findElementsByText(searchText, parentElement, options = {}) {
  const { caseSensitive = false, partial = false } = options;
  if (!searchText) return [];

  const norm = (s) => caseSensitive ? s.trim() : s.trim().toLowerCase();
  const target = norm(searchText);

  const nodes = parentElement.querySelectorAll(
    "p, span, div, a, li, button, h1, h2, h3, h4, h5, h6"
  );

  const exact = [];
  const partials = [];
  for (const el of nodes) {
    const t = el.textContent ? norm(el.textContent) : "";
    if (!t) continue;
    if (t === target) exact.push(el);
    else if (partial && t.includes(target)) partials.push(el);
  }
  return exact.length ? exact : partials;
}

/**
 * Extract the NAME + PROFILE URL from a "name P" node.
 * - Prefer the first <a href="/in/..."> for both text and URL.
 * - Otherwise fall back to any <a> text (URL may be null if not a profile).
 * - As a last resort use the P's text (drop badges like "• 1st").
 */
function extractNameAndUrlFromNameP(pEl) {
  if (!pEl) return { name: null, profileUrl: null };

  const profileA = pEl.querySelector('a[href*="/in/"]');
  if (profileA) {
    return {
      name: clean(profileA.textContent) || null,
      profileUrl: normalizeLinkedInUrl(profileA.getAttribute("href"))
    };
  }

  const anyA = pEl.querySelector("a");
  if (anyA) {
    return {
      name: clean(anyA.textContent) || null,
      profileUrl: anyA.hasAttribute("href") ? normalizeLinkedInUrl(anyA.getAttribute("href")) : null
    };
  }

  // Fallback: P text minus relationship badge like "• 1st"
  let t = clean(pEl.textContent);
  t = t.replace(/\s*•\s*\d+(st|nd|rd|th)\s*$/i, "");
  return { name: t || null, profileUrl: null };
}

/**
 * Try to extract from the "anchor block" format (Format A):
 * info → (some wrapper) → <a href="/in/..."> → (div) → <p><a>NAME</a></p> + <p>DESCRIPTION</p>
 */
function extractFromAnchorBlock(infoContainer) {
  const anchor = infoContainer.querySelector('a[href*="/in/"]');
  if (!anchor) return { name: null, description: null, profileUrl: null };

  const ps = Array.from(anchor.querySelectorAll("p"));
  let name = null;
  let description = null;
  let profileUrl = normalizeLinkedInUrl(anchor.getAttribute("href"));

  if (ps[0]) {
    const { name: n, profileUrl: maybeUrl } = extractNameAndUrlFromNameP(ps[0]);
    name = n || name;
    // prefer the inner profile link if present
    profileUrl = maybeUrl || profileUrl || null;
  }
  if (ps[1]) {
    const d = clean(ps[1].textContent);
    if (d && !/^connected on\b/i.test(d)) description = d;
  }

  return { name, description, profileUrl };
}

/**
 * Try to extract from the "direct children" format (Format B):
 * info → <p>(NAME + badges)</p> + <p>DESCRIPTION</p> + <p>LOCATION</p>
 */
function extractFromDirectChildren(infoContainer) {
  const kids = Array.from(infoContainer.children);
  let name = null;
  let description = null;
  let location = null;
  let profileUrl = null;

  // NAME from first child (prefer <a href="/in/...">)
  if (kids[0]) {
    const r = extractNameAndUrlFromNameP(kids[0]);
    name = r.name;
    profileUrl = r.profileUrl;
  }

  // DESCRIPTION from second child (if not "Connected on ...")
  if (kids[1]) {
    const d = clean(kids[1].textContent);
    if (d && !/^connected on\b/i.test(d)) description = d;
  }

  // LOCATION from third child; validate with isLikelyLocation, else scan further kids
  if (kids[2]) {
    const locCand = clean(kids[2].textContent);
    if (locCand && isLikelyLocation(locCand)) {
      location = locCand;
    }
  }
  if (!location && kids.length > 2) {
    const tail = kids.slice(2);
    for (const node of tail) {
      const texts = Array.from(node.querySelectorAll("p, span, li, small"))
        .map(n => clean(n.textContent))
        .filter(Boolean);
      for (const t of texts) {
        if (/^connected on\b/i.test(t)) continue;
        if (isLikelyLocation(t)) { location = t; break; }
      }
      if (location) break;
    }
  }

  return { name, description, location, profileUrl };
}

/**
 * Extract { img, name, description, location, profile_url } from the element's sibling group.
 * Supports both formats A and B without class/id.
 */
function extractProfileFromSiblings(anyChildEl) {
  if (!anyChildEl || !anyChildEl.parentElement) {
    return { img: null, name: null, description: null, location: null, profile_url: null };
  }

  // siblings group = image container + info container
  const group = Array.from(anyChildEl.parentElement.children);
  if (group.length < 2) return { img: null, name: null, description: null, location: null, profile_url: null };

  const imgContainer = group.find(el => el.querySelector("img")) || null;
  const infoContainer = group.find(el => el !== imgContainer) || null;

  // IMG
  const imgEl = imgContainer ? imgContainer.querySelector("img") : null;
  const img = imgEl ? (imgEl.src || null) : null;

  if (!infoContainer) {
    return { img, name: null, description: null, location: null, profile_url: null };
  }

  // Try Format A first (anchor block inside)
  let { name, description, profileUrl } = extractFromAnchorBlock(infoContainer);

  // If name/description or profileUrl missing, try Format B (direct children)
  let location = null;
  if (!name || !description || !profileUrl) {
    const r = extractFromDirectChildren(infoContainer);
    name = name || r.name;
    description = description || r.description;
    location = r.location || null;
    profileUrl = profileUrl || r.profileUrl || null;
  } else {
    // We still need a location; use the same logic as Format B for the tail
    const kids = Array.from(infoContainer.children);
    if (kids.length > 1) {
      const trailing = kids.filter(el => {
        const a = infoContainer.querySelector('a[href*="/in/"]');
        return a ? !el.contains(a) : true;
      });
      for (const node of trailing) {
        const texts = Array.from(node.querySelectorAll("p, span, li, small"))
          .map(n => clean(n.textContent))
          .filter(Boolean);
        for (const t of texts) {
          if (/^connected on\b/i.test(t)) continue;
          if (isLikelyLocation(t)) { location = t; break; }
        }
        if (location) break;
      }
    }
  }

  return {
    img: img || null,
    name: name || null,
    description: description || null,
    location: location || null,
    profile_url: profileUrl || null,
  };
}

/**
 * Print siblings of a given element only if there are exactly 2,
 * then extract & print the final object.
 */
function printSiblings(element) {
  if (!element || !element.parentElement) return null;
  const siblings = Array.from(element.parentElement.children).filter(c => c !== element);
  if (siblings.length !== 2) return null;

  const profile = extractProfileFromSiblings(element);
  // console.log("Extracted profile object:", profile);
  return profile;
}


const scrapeProfiles = (page_element) => {
    let matches = findElementsByText("message", page_element, { partial: false });
    matches = matches.concat(findElementsByText("connect", page_element, { partial: false }));
    const profiles = []
    if (matches.length) {
      matches.forEach(match => {
        const profile_data = printSiblings(match)
          if (profile_data) profiles.push(profile_data)
      });
    }
    return profiles
}






// ---- text search within a parent ----
function findElementsByText(searchText, parentElement, options = {}) {
  const { caseSensitive = false, partial = false } = options;
  if (!searchText || !parentElement) return [];

  const norm = (s) => (caseSensitive ? s.trim() : s.trim().toLowerCase());
  const target = norm(searchText);

  const nodes = parentElement.querySelectorAll(
    "p, span, div, a, li, button, h1, h2, h3, h4, h5, h6"
  );

  const exact = [];
  const partials = [];
  for (const el of nodes) {
    const t = el.textContent ? norm(el.textContent) : "";
    if (!t) continue;
    if (t === target) exact.push(el);
    else if (partial && t.includes(target)) partials.push(el);
  }
  return exact.length ? exact : partials;
}

// ---- helpers ----
function isVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return cs.display !== "none" &&
         cs.visibility !== "hidden" &&
         rect.width > 0 &&
         rect.height > 0;
}

function findButtonInside(el) {
  if (!el) return null;
  return el.querySelector("button,[role='button'],a[role='button']") || el;
}

// ---- repeatedly click the load button every 5 seconds, INSIDE a given iframe ----
function startAutoClickLoadMore(
  { text = "load more", partial = false, intervalMs = 5000 } = {},
  iframe // HTMLIFrameElement
) {
  // Validate iframe + same-origin access
  if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
    console.warn("startAutoClickLoadMore: invalid or missing iframe");
    return null;
  }

  let iframeWin, iframeDoc;
  try {
    iframeWin = iframe.contentWindow;
    iframeDoc = iframeWin?.document;
  } catch (e) {
    console.warn("startAutoClickLoadMore: cannot access iframe (cross-origin?)", e);
    return null;
  }
  if (!iframeWin || !iframeDoc) {
    console.warn("startAutoClickLoadMore: iframe content not available yet");
    return null;
  }

  // --- helpers bound to the iframe context ---
  function isVisibleIn(el) {
    if (!el) return false;
    const cs = iframeWin.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return cs.display !== "none" &&
           cs.visibility !== "hidden" &&
           rect.width > 0 &&
           rect.height > 0;
  }

  function findButtonInside(el) {
    if (!el) return null;
    return el.querySelector("button,[role='button'],a[role='button']") || el;
  }

  function findElementsByTextIn(searchText, parentElement, { caseSensitive = false, partial = false } = {}) {
    if (!searchText || !parentElement) return [];
    const norm = (s) => (caseSensitive ? s.trim() : s.trim().toLowerCase());
    const target = norm(searchText);

    const nodes = parentElement.querySelectorAll(
      "p, span, div, a, li, button, h1, h2, h3, h4, h5, h6"
    );

    const exact = [];
    const partials = [];
    for (const el of nodes) {
      const t = el.textContent ? norm(el.textContent) : "";
      if (!t) continue;
      if (t === target) exact.push(el);
      else if (partial && t.includes(target)) partials.push(el);
    }
    return exact.length ? exact : partials;
  }

  let failCount = 0;

  const intervalId = iframeWin.setInterval( async () => {
    // If iframe got navigated or detached, stop
    if (!document.body.contains(iframe)) {
      console.warn("Iframe removed from DOM — stopping auto-click.");
      iframeWin.clearInterval(intervalId);
      return;
    }

    // If we lost access (e.g., navigation), stop
    try {
      // touch to ensure access
      void iframeDoc.body;
    } catch (e) {
      console.warn("Lost access to iframe document — stopping auto-click.", e);
      iframeWin.clearInterval(intervalId);
      return;
    }

    // Find text matches inside the iframe
    const loadCandidates = findElementsByTextIn(text, iframeDoc, { partial });

    if (!loadCandidates.length) {
      console.warn(`No elements with text '${text}' found in iframe.`);
      failCount++;
    } else {
      // Find first visible button inside any candidate
      const btn = loadCandidates.map(findButtonInside).find(isVisibleIn);

      if (!btn) {
        console.warn("Found matches in iframe but none are visible/clickable.");
        failCount++;
      } else {
        // Found a valid button → reset fail count and click it
        failCount = 0;
        btn.scrollIntoView({ block: "center" });
        btn.dispatchEvent(
          new iframeWin.MouseEvent("click", { bubbles: true, cancelable: true, view: iframeWin })
        );
        console.log("[iframe] Clicked load button at", new Date().toLocaleTimeString());

        // Optional: call scraper with the iframe's document, if available globally
        if (typeof scrapeProfiles === "function") {
          try {
            // console.log(scrapeProfiles(iframeDoc));
            const profiles = scrapeProfiles(iframeDoc);

            // localStorage.setItem('lsc-latest-profiles', JSON.stringify(profiles || []));
            chrome.storage.local.set({ 'lsc-latest-profiles': profiles || [] });

            console.log(await chrome.storage.local.get('lsc-latest-profiles'));
          } catch (e) {
            console.warn("scrapeProfiles threw inside iframe:", e);
          }
        }
      }
    }

    // Stop after 3 consecutive failures
    if (failCount >= 3) {
      console.warn("Load button not found after 3 attempts (iframe). Stopping auto-click.");
      iframeWin.clearInterval(intervalId);
    }
  }, intervalMs);

  // Also stop auto-clicking if the iframe unloads/navigates
  iframe.addEventListener("load", () => {
    try { iframeWin.clearInterval(intervalId); } catch {}
  }, { once: true });

  return intervalId; // for manual clear if needed
}

