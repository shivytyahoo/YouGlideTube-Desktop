/**
 * What the Home key does on a routed page: scrolls the page back to the top without reloading
 * it. The app shell itself never scrolls, so the browser's own Home handling has nowhere to go;
 * this scrolls the page's scrollport instead.
 *
 * Most pages scroll in PageWrapper's `<main>`. A few pages (playlist details, library, history)
 * keep `<main>` fixed and scroll in their own pane, so when `<main>` cannot scroll the first
 * scrolled pane underneath it is the page.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // The target itself or an ancestor may be an editable region (a rich-text editor's child).
  const attr = target.getAttribute("contenteditable");
  if (attr !== null && attr !== "false") return true;
  const editable = target.closest("[contenteditable]");
  if (editable && editable.getAttribute("contenteditable") !== "false") return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const canScroll = (el: HTMLElement): boolean => el.scrollHeight > el.clientHeight + 1;

/** True when something was scrolled; false when the page was already at the top. */
export function scrollPageToTop(root: HTMLElement | null): boolean {
  if (!root) return false;
  if (canScroll(root)) {
    root.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }
  const inner = [...root.querySelectorAll("*")].find(
    (el): el is HTMLElement => el instanceof HTMLElement && el.scrollTop > 0 && canScroll(el),
  );
  if (!inner) return false;
  inner.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}
