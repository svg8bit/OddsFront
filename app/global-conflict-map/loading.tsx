export default function GlobalConflictMapLoading() {
  return (
    <main
      style={{
        display: "grid",
        width: "100vw",
        height: "100dvh",
        placeItems: "center",
        background: "#050D18",
        color: "#71839A",
        font: "500 13px var(--font-ui)",
      }}
      aria-label="Loading global conflict map"
    >
      Preparing live map…
    </main>
  );
}
