/**
 * Renders a Telegram HTML caption (parse_mode=HTML subset) for preview.
 * Everything is escaped first; only attribute-less formatting tags and
 * http(s) links are re-enabled, so the output is safe for innerHTML.
 */
export function telegramHtmlPreview(input: string): string {
  let s = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const simple: Record<string, string> = { b: "b", strong: "b", i: "i", em: "i", u: "u", ins: "u", s: "s", strike: "s", del: "s", code: "code", pre: "pre", blockquote: "blockquote" };
  for (const [tag, out] of Object.entries(simple)) {
    s = s.replace(new RegExp(`&lt;${tag}&gt;`, "gi"), `<${out}>`).replace(new RegExp(`&lt;/${tag}&gt;`, "gi"), `</${out}>`);
  }
  s = s.replace(/&lt;tg-spoiler&gt;/gi, '<span class="adm-spoiler">').replace(/&lt;\/tg-spoiler&gt;/gi, "</span>");
  s = s.replace(/&lt;a href=&quot;(https?:\/\/(?:[^&"<>\s]|&amp;)+)&quot;&gt;/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">').replace(/&lt;\/a&gt;/gi, "</a>");
  // Entities the author wrote (&amp; &lt; &gt; &quot;) were double-escaped above — restore one level.
  // Done last so that escaped text like "&lt;b&gt;" never turns into a tag.
  s = s.replace(/&amp;(amp|lt|gt|quot);/g, "&$1;");
  return s.replace(/\n/g, "<br/>");
}
