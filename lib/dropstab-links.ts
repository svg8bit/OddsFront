const DROPSTAB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isDropstabAssetSlug(value: unknown): value is string {
  return typeof value === "string" && DROPSTAB_SLUG_PATTERN.test(value);
}

export function buildDropstabAssetUrl(slug: unknown): string | null {
  if (!isDropstabAssetSlug(slug)) return null;
  return `https://dropstab.com/coins/${slug}`;
}

export function buildDropsBotAssetTrackUrl(slug: unknown): string | null {
  if (!isDropstabAssetSlug(slug)) return null;
  return `https://t.me/Drops?start=dropstab_${slug}`;
}
