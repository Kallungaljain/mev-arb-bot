/**
 * tRPC client stub.
 *
 * The MEV bot app does not use tRPC procedures directly.
 * This file exists only to satisfy the template's _layout.tsx import.
 * We do NOT import from server/routers here because that would pull in
 * ethers + ws (Node.js-only) which crash on Android/iOS.
 */

// No-op exports to avoid import errors if anything still references this file
export const trpc = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export function createTRPCClient() { return {} as any; } // eslint-disable-line @typescript-eslint/no-explicit-any
