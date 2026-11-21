import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TopbarSearch } from "./TopbarSearch";
import { useSettingsSearchStore } from "../../store/useSettingsSearchStore";
import { useUiStore } from "../../store/useUiStore";
import { getString } from "../../lib/i18n/index";
import type { SpeechRecognitionInstance } from "../../lib/voiceSearch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A controllable stand-in for the webview's speech recognizer. */
class FakeRecognition implements SpeechRecognitionInstance {
  static last: FakeRecognition | null = null;
  lang = "";
  onresult: SpeechRecognitionInstance["onresult"] = null;
  onerror: SpeechRecognitionInstance["onerror"] = null;
  onend: SpeechRecognitionInstance["onend"] = null;
  started = false;

  constructor() {
    FakeRecognition.last = this;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.onend?.();
  }

  result(transcript: string): void {
    this.onresult?.({ results: [[{ transcript }]] });
  }
}

let host: HTMLDivElement;
let root: Root;

function renderTopbarSearch(path = "/") {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(TopbarSearch)));
  });
}

describe("TopbarSearch", () => {
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
    useUiStore.getState().dismissToast();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    FakeRecognition.last = null;
  });

  it("renders default search placeholder on standard routes", () => {
    renderTopbarSearch("/");
    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe(getString("search_placeholder"));
  });

  it("renders settings search placeholder when on /settings", () => {
    renderTopbarSearch("/settings");
    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe(getString("settings_search_placeholder"));
  });

  it("keeps searching YouTube on the pages under /settings/", () => {
    for (const path of ["/settings/import", "/settings/discover-channels", "/settings/diagnostics"]) {
      act(() => root.unmount());
      root = createRoot(host);
      renderTopbarSearch(path);
      const input = host.querySelector("input");
      expect(input?.placeholder).toBe(getString("search_placeholder"));
      expect(input?.getAttribute("role")).toBe("combobox");
    }
  });

  it("is a plain search field, not a suggestions combobox, on /settings", () => {
    renderTopbarSearch("/settings");
    const input = host.querySelector("input");
    expect(input?.getAttribute("role")).toBeNull();
    expect(input?.getAttribute("aria-label")).toBe(getString("settings_search_placeholder"));
  });

  it("updates useSettingsSearchStore when typing on /settings", () => {
    renderTopbarSearch("/settings");
    const input = host.querySelector("input")!;
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "ambient");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useSettingsSearchStore.getState().query).toBe("ambient");
  });

  it("clears useSettingsSearchStore when clicking clear button on /settings", () => {
    useSettingsSearchStore.getState().setQuery("playback");
    renderTopbarSearch("/settings");
    const input = host.querySelector("input")!;
    expect(input.value).toBe("playback");

    const clearBtn = host.querySelector("button[title*='Clear'], button[aria-label*='Clear']");
    expect(clearBtn).not.toBeNull();
    act(() => {
      clearBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useSettingsSearchStore.getState().query).toBe("");
  });

  it("clears settings query on Escape key press when on /settings", () => {
    useSettingsSearchStore.getState().setQuery("volume");
    renderTopbarSearch("/settings");
    const input = host.querySelector("input")!;
    expect(input.value).toBe("volume");

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useSettingsSearchStore.getState().query).toBe("");
  });

  it("shows a voice search button on standard routes, but not on /settings", () => {
    renderTopbarSearch("/");
    expect(host.querySelector(`button[aria-label="${getString("search_voice_search")}"]`)).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    renderTopbarSearch("/settings");
    expect(host.querySelector(`button[aria-label="${getString("search_voice_search")}"]`)).toBeNull();
  });

  it("shows an honest error when the webview exposes no recognizer", () => {
    renderTopbarSearch("/");
    const mic = host.querySelector(`button[aria-label="${getString("search_voice_search")}"]`)!;
    act(() => {
      mic.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useUiStore.getState().toast?.message).toBe(getString("search_voice_unavailable"));
    expect(useUiStore.getState().toast?.variant).toBe("error");
  });

  it("runs the recognised text as a search when a recognizer is available", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    renderTopbarSearch("/");
    const mic = host.querySelector(`button[aria-label="${getString("search_voice_search")}"]`)!;
    act(() => {
      mic.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(FakeRecognition.last?.started).toBe(true);

    act(() => {
      FakeRecognition.last?.result("cats");
      FakeRecognition.last?.onend?.();
    });
    expect(host.querySelector("input")?.value).toBe("cats");
  });
});
