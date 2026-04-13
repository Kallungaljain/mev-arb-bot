// ─── Safe tRPC Router Type Stub ───────────────────────────────────────────────
// This file provides the AppRouter type to the React Native app WITHOUT
// importing any server-side code (ethers, ws, EventEmitter, etc.).
//
// The actual AppRouter is defined in server/routers.ts but we cannot import
// it directly in the app bundle because it transitively imports Node.js-only
// packages that crash on Android/iOS.
//
// We use `any` here intentionally — the tRPC client still works correctly at
// runtime because it communicates over HTTP, not through the type system.
// The only loss is compile-time type safety for tRPC procedure calls, which
// is acceptable since this app does not use tRPC procedures directly.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppRouter = any;
