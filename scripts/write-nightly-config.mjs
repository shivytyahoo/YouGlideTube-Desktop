import { readFileSync, writeFileSync } from "node:fs";
import {
  nightlyDownloadUrl,
  nightlyManifestName,
  nightlyVersion,
} from "./nightly-version.mjs";

const baseConfig = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8"),
);
const runNumber = process.env.GITHUB_RUN_NUMBER || String(Date.now());
const version = nightlyVersion(baseConfig.version, runNumber, process.platform);
// Nightlies update from the fork's own nightly release. The base config
// carries no updater section until the release updater is set up (see
// TAURI_PLAN.md step 4), so the repository must come from the environment.
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) {
  throw new Error("GITHUB_REPOSITORY is required to generate the nightly config");
}

const nightlyConfig = {
  $schema: "https://schema.tauri.app/config/2",
  productName: "YouGlideTube Nightly",
  version,
  identifier: "io.github.shivytyahoo.glidetube.desktop.nightly",
  // Linux packages share /usr/bin, so each channel needs its own binary there.
  // Windows and macOS keep the name their installers and shortcuts expect.
  ...(process.platform === "linux" && {
    mainBinaryName: "youglidetube-nightly",
  }),
  plugins: {
    updater: {
      endpoints: [
        nightlyDownloadUrl(repository, nightlyManifestName(process.platform)),
      ],
      // Nightlies have their own key, so the stable key signs only tagged
      // releases.
      pubkey: readFileSync("src-tauri/updater-nightly.pub", "utf8").trim(),
    },
  },
  bundle: {
    // A later job signs the packages, so the signing key never reaches the
    // build or its dependencies.
    createUpdaterArtifacts: false,
    // The firewall profiles belong to the stable package: two channels shipping the same files
    // can't be installed side by side. `null` removes them in Tauri's config merge.
    linux: { deb: { files: null }, rpm: { files: null } },
    shortDescription: "Nightly testing build of YouGlideTube Desktop.",
    longDescription:
      "An automatically generated testing build of YouGlideTube Desktop. Nightly builds use isolated application data and may be unstable.",
  },
};

writeFileSync(
  "src-tauri/tauri.nightly.generated.json",
  `${JSON.stringify(nightlyConfig, null, 2)}\n`,
);

console.log(`Generated YouGlideTube Nightly configuration for version ${version}`);
