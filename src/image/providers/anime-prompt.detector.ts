import { Injectable } from '@nestjs/common';

/**
 * Términos que indican de forma explícita un estilo anime/ilustración japonesa.
 * Deben ir en minúsculas: el matching se hace sobre el prompt normalizado.
 *
 * Nota: NO se incluyen palabras ambiguas como "illustration", "cartoon",
 * "drawing" o "character" por sí solas, porque no implican anime de forma
 * inequívoca.
 */
export const ANIME_KEYWORDS: readonly string[] = [
  'anime',
  'manga',
  'cel shading',
  'anime illustration',
  'anime character',
  'japanese animation',
  '2d anime',
  'waifu',
  'shonen',
  'shoujo',
  'bishounen',
  'visual novel',
  'anime screencap',
];

/** Escapa caracteres especiales de regex en un literal. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Una sola regex con límites de palabra (\b) para todos los keywords.
 * `\b` evita falsos positivos por subcadenas (p.ej. "animed" no debería contar,
 * aunque en la práctica no es una palabra) y es determinista.
 */
const ANIME_REGEX = new RegExp(
  `\\b(?:${ANIME_KEYWORDS.map(escapeRegExp).join('|')})\\b`,
);

/**
 * Detector determinista y case-insensitive de prompts con intención "anime".
 *
 * Reglas:
 * - Normaliza con `prompt.trim().toLowerCase()` antes de comparar.
 * - Devuelve `true` si aparece CUALQUIER keyword explícito de {@link ANIME_KEYWORDS}.
 * - Si el prompt mezcla instrucciones realistas y anime, basta un keyword
 *   explícito para clasificarlo como anime (gana lo explícito).
 */
@Injectable()
export class AnimePromptDetector {
  isAnimePrompt(prompt: string): boolean {
    const normalizedPrompt = (prompt ?? '').trim().toLowerCase();
    if (!normalizedPrompt) {
      return false;
    }
    return ANIME_REGEX.test(normalizedPrompt);
  }
}
