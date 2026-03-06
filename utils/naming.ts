/**
 * Name uniqueness utilities.
 *
 * Rules (like Windows file explorer):
 *  - No two projects can share a name
 *  - No two nuggets within the same project can share a name
 *  - No two cards within the same folder (or root level) can share a name
 *  - No two documents within the same nugget can share a name
 *
 * All comparisons are case-insensitive.
 */

/**
 * Generate a unique name within a set of existing names.
 *
 * For regular names:  "Foo" → "Foo (2)" → "Foo (3)" …
 * For filenames:      "report.pdf" → "report (2).pdf" → "report (3).pdf" …
 *
 * @param baseName  The desired name
 * @param existingNames  Names that already exist in the scope
 * @param isFile  When true, insert the counter before the file extension
 */
export function getUniqueName(baseName: string, existingNames: string[], isFile = false): string {
  const lower = existingNames.map((n) => n.toLowerCase());
  if (!lower.includes(baseName.toLowerCase())) return baseName;

  let counter = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let candidate: string;
    if (isFile) {
      const dotIndex = baseName.lastIndexOf('.');
      if (dotIndex > 0) {
        candidate = `${baseName.slice(0, dotIndex)} (${counter})${baseName.slice(dotIndex)}`;
      } else {
        candidate = `${baseName} (${counter})`;
      }
    } else {
      candidate = `${baseName} (${counter})`;
    }
    if (!lower.includes(candidate.toLowerCase())) return candidate;
    counter++;
  }
}

/**
 * Check whether a name already exists in a list (case-insensitive).
 *
 * @param name  The name to check
 * @param existingNames  Existing names in scope
 * @param excludeSelf  Optionally exclude one name from the check (the item's current name)
 */
export function isNameTaken(name: string, existingNames: string[], excludeSelf?: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return existingNames.some((n) => {
    if (excludeSelf && n.toLowerCase() === excludeSelf.toLowerCase()) return false;
    return n.toLowerCase() === trimmed;
  });
}
