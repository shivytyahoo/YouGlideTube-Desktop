import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api/db", () => ({ addWatchRecord: vi.fn(() => Promise.resolve()) }));
vi.mock("./deepGlide", () => ({ shouldRecordWatchHistory: () => true }));
vi.mock("./recap/recapQueue", () => ({ recapView: vi.fn() }));

import { addWatchRecord } from "./api/db";
import { recapView } from "./recap/recapQueue";
import { finishShortView, noteShortProgress, startShortView } from "./shortViews";
import type { ShortItem } from "../types/shorts";

const short = (id: string): ShortItem => ({
  id,
  title: `Short ${id}`,
  channelName: "Channel",
  channelId: "UC1",
  thumbnailUrl: "",
});

describe("shortViews", () => {
  beforeEach(() => {
    vi.mocked(addWatchRecord).mockClear();
    vi.mocked(recapView).mockClear();
  });
  afterEach(() => {
    finishShortView();
  });

  it("records one viewing when the next Short starts", () => {
    startShortView(short("a"));
    noteShortProgress("a", 4000, 30000);
    noteShortProgress("a", 6000, 30000);
    startShortView(short("b"));
    expect(recapView).toHaveBeenCalledTimes(1);
    expect(recapView).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "a", watchedMs: 6000, counted: true, skipped: false }),
    );
  });

  it("saves a Short to history unless it was flicked past", () => {
    startShortView(short("a"));
    noteShortProgress("a", 1500, 30000);
    startShortView(short("b"));
    noteShortProgress("b", 8000, 30000);
    finishShortView();
    expect(addWatchRecord).toHaveBeenCalledTimes(1);
    expect(addWatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "b", watchDurationSeconds: 8, totalDurationSeconds: 30, isShort: true }),
    );
  });

  it("tells the recap a watched Short from one swiped past", () => {
    startShortView(short("a"));
    noteShortProgress("a", 1500, 30000);
    startShortView(short("b"));
    noteShortProgress("b", 8000, 30000);
    finishShortView();
    expect(recapView).toHaveBeenCalledTimes(2);
    expect(recapView).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ videoId: "a", format: "SHORT", watchedMs: 1500, counted: false, skipped: true }),
    );
    expect(recapView).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ videoId: "b", format: "SHORT", watchedMs: 8000, counted: true, skipped: false }),
    );
  });

  it("ignores progress from another Short and a Short that never played", () => {
    startShortView(short("a"));
    noteShortProgress("z", 5000, 30000);
    finishShortView();
    expect(recapView).not.toHaveBeenCalled();
  });
});
