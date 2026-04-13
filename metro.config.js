const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// ─── Block server-side modules from the native app bundle ─────────────────────
// server/ contains Node.js-only code (ethers, ws, EventEmitter) that crashes
// on Android/iOS. Block the entire directory at the Metro bundler level.
const serverDir = path.resolve(__dirname, "server");
const serverBlockPattern = new RegExp(
  `^${serverDir.replace(/[\\/]/g, "[\\\\/]")}.*$`
);
const existing = config.resolver?.blockList;
config.resolver = {
  ...config.resolver,
  blockList: existing
    ? Array.isArray(existing)
      ? [...existing, serverBlockPattern]
      : [existing, serverBlockPattern]
    : serverBlockPattern,
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
