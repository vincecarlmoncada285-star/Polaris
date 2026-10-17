// File names for exports: a slug of the title, e.g. "Climate essay" → "climate-essay.docx".

const MAX_SLUG = 80;

/** Lowercase ASCII letters, digits and single dashes; accents dropped; "untitled" if empty. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "untitled";
  if (slug.length <= MAX_SLUG) return slug;
  const cut = slug.slice(0, MAX_SLUG);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > MAX_SLUG / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

export const exportFileName = (title: string, extension: string) =>
  `${slugify(title)}.${extension}`;

/**
 * Unique names for a set of titles, in order: the second "essay" becomes "essay-2", and so on,
 * never colliding with a title that is itself "essay-2".
 */
export function uniqueSlugs(titles: readonly string[]): string[] {
  const taken = new Set<string>();
  return titles.map((title) => {
    const base = slugify(title);
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  });
}
