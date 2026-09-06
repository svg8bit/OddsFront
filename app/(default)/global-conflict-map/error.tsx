"use client";

export default function GlobalConflictMapError({ reset }: { reset: () => void }) {
  return (
    <main className="map-loading map-error" role="alert">
      <strong>The map could not load.</strong>
      <span>The public feed may be temporarily unavailable.</span>
      <button type="button" onClick={reset}>
        Retry
      </button>
    </main>
  );
}
