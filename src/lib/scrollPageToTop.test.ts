import { describe, expect, it, vi } from "vitest";

import { isEditableTarget, scrollPageToTop } from "./scrollPageToTop";

const sized = (el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0): void => {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
  el.scrollTo = vi.fn();
};

describe("isEditableTarget", () => {
  it("keeps Home in text fields, where it moves the caret", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isEditableTarget(editable)).toBe(true);
  });

  it("lets Home through everywhere else", () => {
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("scrollPageToTop", () => {
  it("scrolls the outer page when it is the scrollport", () => {
    const main = document.createElement("main");
    sized(main, 2000, 800, 500);
    expect(scrollPageToTop(main)).toBe(true);
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("scrolls the page's own pane when the outer page cannot scroll", () => {
    const main = document.createElement("main");
    sized(main, 800, 800);
    const pane = document.createElement("div");
    sized(pane, 2000, 800, 400);
    main.append(pane);
    expect(scrollPageToTop(main)).toBe(true);
    expect(pane.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(main.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is scrolled", () => {
    const main = document.createElement("main");
    sized(main, 800, 800);
    expect(scrollPageToTop(main)).toBe(false);
    expect(main.scrollTo).not.toHaveBeenCalled();
    expect(scrollPageToTop(null)).toBe(false);
  });
});
