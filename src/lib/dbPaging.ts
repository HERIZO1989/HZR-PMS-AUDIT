const PAGE = 1000;

/** Lit toutes les lignes d'une requete par pages de 1 000 (limite PostgREST) ; la requete doit avoir un ordre stable. */
export async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
