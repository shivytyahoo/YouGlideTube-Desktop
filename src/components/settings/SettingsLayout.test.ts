import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsLayout, type SettingsCategory } from "./SettingsLayout";
import { useSettingsSearchStore } from "../../store/useSettingsSearchStore";
import { getString, type StringKey } from "../../lib/i18n/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const renderSettingsLayout = () => {
  root.render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/settings"] },
      createElement(SettingsLayout, {
        children: (tab: SettingsCategory) => createElement("div", null, `Tab: ${tab}`),
      }),
    ),
  );
};

describe("SettingsLayout", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    useSettingsSearchStore.getState().clearQuery();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useSettingsSearchStore.getState().clearQuery();
  });

  it("does not render duplicate search input in the sidebar navigation", () => {
    act(() => {
      renderSettingsLayout();
    });

    const nav = host.querySelector("nav");
    expect(nav).not.toBeNull();
    // Verify there is no input element inside nav
    expect(nav?.querySelector("input")).toBeNull();
    // Default child content renders
    expect(host.textContent).toContain("Tab: appearance");
  });

  it("renders search results when query is present in useSettingsSearchStore", async () => {
    act(() => {
      renderSettingsLayout();
    });

    act(() => {
      useSettingsSearchStore.getState().setQuery("theme");
    });

    // Wait for debounce (120ms) inside act
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // Results view should show matching settings (e.g. Theme variant / Appearance)
    expect(host.textContent).toContain("Theme variant");
  });

  it("clears query when clicking a category tab", () => {
    act(() => {
      renderSettingsLayout();
    });

    act(() => {
      useSettingsSearchStore.getState().setQuery("theme");
    });
    expect(useSettingsSearchStore.getState().query).toBe("theme");

    const playerTabBtn = Array.from(host.querySelectorAll("nav button")).find((btn) =>
      btn.textContent?.includes(getString("settings_player")),
    );
    expect(playerTabBtn).not.toBeUndefined();

    act(() => {
      playerTabBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useSettingsSearchStore.getState().query).toBe("");
    expect(host.textContent).toContain("Tab: player");
  });

  it("clears search query on unmount", () => {
    act(() => {
      renderSettingsLayout();
    });

    act(() => {
      useSettingsSearchStore.getState().setQuery("font");
    });
    expect(useSettingsSearchStore.getState().query).toBe("font");

    act(() => {
      root.unmount();
    });

    expect(useSettingsSearchStore.getState().query).toBe("");
  });

  it("orders tabs after Android's grouped settings home", () => {
    act(() => {
      renderSettingsLayout();
    });

    const labels = Array.from(host.querySelectorAll("nav button")).map((btn) => btn.textContent?.trim());
    expect(labels).toEqual([
      getString("account_title"),
      getString("settings_content_ui"),
      getString("settings_player"),
      getString("settings_quality_codecs"),
      getString("settings_music"),
      getString("music_lyrics"),
      getString("settings_group_integrations"),
      getString("settings_subscriptions_notifications"),
      getString("settings_appearance"),
      getString("settings_language_region"),
      getString("settings_keyboard_shortcuts"),
      getString("settings_downloads"),
      getString("settings_history_privacy"),
      getString("settings_data_backup"),
      getString("settings_notifications"),
      getString("settings_network_buffer"),
      getString("settings_digital_wellbeing"),
      getString("settings_about"),
    ]);

    const headers: StringKey[] = [
      "settings_group_watching",
      "settings_group_look",
      "settings_group_data",
      "settings_group_system",
      "settings_header_about",
    ];
    for (const header of headers) {
      expect(host.textContent).toContain(getString(header));
    }
  });
});
