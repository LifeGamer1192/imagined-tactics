// P133: the faces of people of the records, shared by hist-sim, ima-rpg and hex-sim. The table is
// public/art/faces/faces.json — { version: 1, eras: { <era>: { <name>: <id> } } }, names split by era (the same
// name in another era is another person; another name for the same person points to the same id) — and the
// pictures are public/art/faces/<era>/<id>.webp (256×320, like the portrait_* faces). The other two copy this file,
// the table and the pictures as they are, so all three find a face the same way. Nothing else is imported here.
// Someone not in the table has no face of their own: each game then uses its own shared faces (by sex and age).

export interface FaceTable {
  version: number;
  eras: Record<string, Record<string, string>>;
}

let table: FaceTable | null = null;

/** use this table (one of another version is ignored) */
export function setFaces(t: FaceTable | null): void {
  table = t && t.version === 1 && t.eras ? t : null;
}

/** the picture of a person of the records, as a path relative to the site ('art/faces/<era>/<id>.webp'), or null */
export function faceFor(era: string, name: string): string | null {
  const id = table?.eras[era]?.[name];
  return id ? `art/faces/${era}/${id}.webp` : null;
}

/** fetch the table from the site (base: the site's root, ending in '/'); no table, no faces */
export async function loadFaces(base = './'): Promise<FaceTable | null> {
  try {
    const r = await fetch(`${base}art/faces/faces.json`);
    setFaces(r.ok ? ((await r.json()) as FaceTable) : null);
  } catch {
    setFaces(null);
  }
  return table;
}
