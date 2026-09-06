"use client";

import { type ComponentProps, useSyncExternalStore } from "react";

import { ConflictMapPreview } from "@/features/global-conflict-map/preview/conflict-map-preview";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Keep SSR enabled on the dynamic import so Next emits the map chunk preloads
// with the HTML. Only WebGL initialization waits for the browser, avoiding a
// second network waterfall after the lightweight loader has hydrated.
export function ConflictMapRuntime(props: ComponentProps<typeof ConflictMapPreview>) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return hydrated ? <ConflictMapPreview {...props} /> : null;
}
