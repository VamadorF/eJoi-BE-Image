/**
 * Detección de prompts de estilo anime/manga.
 *
 * Se usa al seleccionar el provider de imagen: si el prompt final del frontend
 * describe claramente una imagen anime, se enruta al provider OpenAI; en caso
 * contrario se mantiene el provider por defecto (Flux).
 */

export const ANIME_KEYWORDS = [
  'anime',
  'anime style',
  'manga',
  'manga style',
  'chibi',
  'waifu',
  'husbando',
  'cel shading',
  'anime lineart',
  'anime eyes',
  'estilo anime',
  'estilo manga',
  'ilustración anime',
  '1girl',
  '1boy',
  'shonen',
  'shoujo',
  'seinen',
  'josei',
] as const;

/**
 * Indica si el prompt contiene una keyword clara de anime/manga.
 *
 * La comparación es case-insensitive y por substring (no por límite de palabra),
 * ya que la lista incluye frases con acentos (`ilustración anime`) y tags con
 * dígitos (`1girl`) donde `\b` en JS es solo ASCII y se comporta de forma
 * inconsistente. Las keywords son lo bastante distintivas como para que el riesgo
 * de falsos positivos sea despreciable.
 */
export function isAnimePrompt(prompt: string): boolean {
  if (!prompt) return false;
  const normalized = prompt.toLowerCase();
  return ANIME_KEYWORDS.some((kw) => normalized.includes(kw));
}
