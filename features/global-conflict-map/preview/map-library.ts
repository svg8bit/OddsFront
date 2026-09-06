import type * as MapLibre from "maplibre-gl";

export const MAP_LIBRARY_URL = "/vendor/maplibre/6.1.0/maplibre-gl.mjs";
let library: Promise<typeof MapLibre> | undefined;

export function loadMapLibrary(): Promise<typeof MapLibre> {
  // Preserve MapLibre's native shared module: bundling it into Next duplicated
  // the same code that the map worker downloads. The versioned module URL lets
  // the browser share its HTTP cache between the main thread and the worker.
  library ??= import(/* webpackIgnore: true */ MAP_LIBRARY_URL).then((module: typeof MapLibre) => {
    module.setWorkerUrl("/vendor/maplibre/6.1.0/maplibre-gl-worker.mjs");
    void module.setRTLTextPlugin("/vendor/rtl-text/0.3.0/mapbox-gl-rtl-text.mjs", true).catch(() => {});
    return module;
  });
  return library;
}
