import { afterEach, describe, expect, it } from "vitest";
import { profileStorage } from "./profileStorage";

afterEach(() => {
  localStorage.clear();
});

describe("profileStorage", () => {
  it("stores keys bare", () => {
    profileStorage.setItem("youglidetube_search_history", "[1]");
    expect(localStorage.getItem("youglidetube_search_history")).toBe("[1]");
    expect(profileStorage.getItem("youglidetube_search_history")).toBe("[1]");
    profileStorage.removeItem("youglidetube_search_history");
    expect(localStorage.getItem("youglidetube_search_history")).toBeNull();
  });

  it("reads a key an earlier build wrote under the old name, then moves it", () => {
    localStorage.setItem("flow_search_history", "[1]");
    expect(profileStorage.getItem("youglidetube_search_history")).toBe("[1]");
    expect(localStorage.getItem("youglidetube_search_history")).toBe("[1]");
    expect(localStorage.getItem("flow_search_history")).toBeNull();

    localStorage.setItem("flow_search_history", "[2]");
    profileStorage.setItem("youglidetube_search_history", "[2]");
    expect(localStorage.getItem("flow_search_history")).toBeNull();

    localStorage.setItem("flow_search_history", "[3]");
    profileStorage.removeItem("youglidetube_search_history");
    expect(localStorage.getItem("flow_search_history")).toBeNull();
    expect(localStorage.getItem("youglidetube_search_history")).toBeNull();
  });

  it("hides keys left over from removed profiles", () => {
    localStorage.setItem("flow_lyrics_a", "1");
    localStorage.setItem("p:study:flow_lyrics_b", "2");
    expect(profileStorage.keys()).toEqual(["flow_lyrics_a"]);
  });
});
