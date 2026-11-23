import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderSidebar(showShorts: boolean, showMusic = true) {
  useAppSettingsStore.setState({
    values: {
      ...useAppSettingsStore.getState().values,
      [SETTINGS.SHORTS_CONTENT_ENABLED]: String(showShorts),
      [SETTINGS.MUSIC_CONTENT_ENABLED]: String(showMusic),
    },
  });
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Sidebar, { mode: "overlay" })));
  });
  return Array.from(host.querySelectorAll("a")).map((link) => link.getAttribute("href"));
}

function renderSidebarNormal() {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Sidebar)));
  });
  return host.querySelector("aside");
}

describe("Sidebar", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("links to Saved Shorts only while Shorts show", () => {
    expect(renderSidebar(true)).toContain("/saved-shorts");
    expect(renderSidebar(false)).not.toContain("/saved-shorts");
  });

  it("links to Music and Albums only while Show Music is on", () => {
    expect(renderSidebar(true, true)).toEqual(expect.arrayContaining(["/music", "/albums"]));
    const links = renderSidebar(true, false);
    expect(links).not.toContain("/music");
    expect(links).not.toContain("/albums");
  });

  it("keeps the rail height-constrained so its nav region can scroll", () => {
    const aside = renderSidebarNormal();
    expect(aside).not.toBeNull();
    // The rail is a flex item of PageWrapper's column; without flex-1 + min-h-0
    // it grows to its content height and the scroll region never engages, so
    // everything below the fold (Downloads, Settings, ...) is unreachable.
    expect(aside?.classList.contains("flex-1")).toBe(true);
    expect(aside?.classList.contains("min-h-0")).toBe(true);
    expect(aside?.classList.contains("flex-col")).toBe(true);
    const scroller = aside?.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller?.classList.contains("min-h-0")).toBe(true);
    expect(scroller?.classList.contains("flex-1")).toBe(true);
  });

  it("renders the items below Likes in the normal rail", () => {
    renderSidebarNormal();
    const links = Array.from(host.querySelectorAll("a")).map((link) => link.getAttribute("href"));
    expect(links).toEqual(
      expect.arrayContaining(["/downloads", "/local-media", "/settings", "/sponsorblock"]),
    );
  });
});
