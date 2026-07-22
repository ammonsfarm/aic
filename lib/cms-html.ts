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
  if (!href) return "";
  if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#")) {
    return href;
  }

  try {
    const parsed = new URL(href);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol) ? href : "";
  } catch {
    return "";
  }
}

export function sanitizeCmsHtml(value: string) {
  const source = /<[a-z][\s\S]*>/i.test(value) ? value : legacyMarkdownToHtml(value);

  return sanitizeHtmlLibrary(source, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "a"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto", "tel"],
    },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        "text-align": [/^(?:left|center|right)$/],
      },
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          rel: "noreferrer noopener",
          ...(attribs.target === "_blank" ? { target: "_blank" } : {}),
        },
      }),
    },
    disallowedTagsMode: "discard",
  });
}
