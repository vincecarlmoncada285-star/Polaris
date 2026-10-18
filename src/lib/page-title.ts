// Browser tab titles: "<page> · Polaris". The root layout's title template adds the suffix on
// the server; the document editor keeps the tab in step with the title as it is typed.

export const SITE_NAME = "Polaris";
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;
export const UNTITLED = "Untitled document";

export const pageTitle = (name: string) => TITLE_TEMPLATE.replace("%s", name);

/** A document's name in the tab (and in its page metadata): "Untitled document" when blank. */
export const documentTitle = (title: string) => title.trim() || UNTITLED;
