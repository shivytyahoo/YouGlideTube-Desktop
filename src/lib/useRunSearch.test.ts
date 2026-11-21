import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRunSearch } from "./useRunSearch";

const navigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useRunSearch>;
let root: ReturnType<typeof createRoot>;

function Harness() {
  latest = useRunSearch();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  root = createRoot(document.createElement("div"));
  act(() => {
    root.render(createElement(Harness));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

describe("useRunSearch", () => {
  it("opens the main search for video scope", () => {
    act(() => {
      latest("cats");
    });
    expect(navigate).toHaveBeenCalledWith("/search?q=cats", undefined);
  });

  it("opens the dedicated music search for music scope", () => {
    act(() => {
      latest("lofi", undefined, "music");
    });
    expect(navigate).toHaveBeenCalledWith("/music/search?q=lofi", undefined);
  });
});
