import sanitizeHtmlLibrary from "sanitize-html";

function escapeCmsHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function legacyMarkdownToHtml(value: string) {
  return escapeCmsHtml(value)
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?!\*)([\s\S]+?)\*/g, "<em>$1</em>")
    .replace(/\[u\]([\s\S]+?)\[\/u\]/g, "<u>$1</u>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
}

export function safeCmsHref(value: string) {
  const href = value.trim();
  if (!href || href.length > 2048 || /[\u0000-\u001f\\]/.test(href)) return "";
  if (href.startsWith("/") && !href.startsWith("//")) {
    try {
      const parsed = new URL(href, "https://www.pastorwood.org");
      return parsed.origin === "https://www.pastorwood.org" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "";
    } catch {
      return "";
    }
  }
  if (/^#[A-Za-z0-9_-]+$/.test(href)) {
    return href;
  }

  try {
    const parsed = new URL(href);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.toString();
    if (parsed.protocol === "mailto:" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname) && !parsed.search && !parsed.hash) return parsed.toString();
    if (parsed.protocol === "tel:" && /^\+?[0-9(). -]+$/.test(parsed.pathname) && !parsed.search && !parsed.hash) return parsed.toString();
    return "";
  } catch {
    return "";
  }
}

export function safeCmsImageSrc(value: string) {
  const source = value.trim();
  if (!source || source.length > 2048 || /[\u0000-\u001f\\]/.test(source) || source.startsWith("//")) return "";
  try {
    const parsed = new URL(source, "https://www.pastorwood.org");
    if (parsed.origin !== "https://www.pastorwood.org" || parsed.search || parsed.hash) return "";
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath.split("/").some((part) => part === "..")) return "";
    return ["/media/legacy/", "/media/cms/", "/images/"].some((prefix) => parsed.pathname.startsWith(prefix)) ? parsed.pathname : "";
  } catch {
    return "";
  }
}

export function sanitizeCmsHtml(value: string) {
  const source = /<[a-z][\s\S]*>/i.test(value) ? value : legacyMarkdownToHtml(value);

  return sanitizeHtmlLibrary(source, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "a", "img"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
    },
    allowedSchemes: ["https", "mailto", "tel"],
    allowedSchemesByTag: {
      a: ["https", "mailto", "tel"],
    },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        "text-align": [/^(?:left|center|right)$/],
      },
    },
    transformTags: {
      a: (_tagName, attribs) => {
        const href = safeCmsHref(attribs.href || "");
        const opensNewWindow = href.startsWith("https://") && attribs.target === "_blank";
        return {
          tagName: "a",
          attribs: {
            ...(href ? { href } : {}),
            ...(attribs.title ? { title: attribs.title.slice(0, 500) } : {}),
            ...(opensNewWindow ? { target: "_blank", rel: "noreferrer noopener" } : {}),
          },
        };
      },
      img: (_tagName, attribs) => ({
        tagName: "img",
        attribs: {
          src: safeCmsImageSrc(attribs.src || ""),
          alt: (attribs.alt || "").slice(0, 500),
          ...(attribs.title ? { title: attribs.title.slice(0, 500) } : {}),
          ...(attribs.width && /^\d{1,5}$/.test(attribs.width) ? { width: attribs.width } : {}),
          ...(attribs.height && /^\d{1,5}$/.test(attribs.height) ? { height: attribs.height } : {}),
          loading: "lazy",
          decoding: "async",
        },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !safeCmsImageSrc(frame.attribs.src || ""),
    disallowedTagsMode: "discard",
  });
}
