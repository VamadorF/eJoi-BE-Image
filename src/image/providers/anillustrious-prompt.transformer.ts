import { Injectable } from '@nestjs/common';

/**
 * Convierte un prompt en lenguaje natural a una lista concisa de tags estilo
 * Danbooru, compatibles con Anillustrious.
 *
 * Es 100% determinista (sin red ni LLM) y NO muta su entrada: opera sobre copias
 * y devuelve un string nuevo. Esta lógica vive separada de la selección de
 * provider y de la llamada a Replicate.
 */

/** Frases introductorias que no aportan al contenido. */
const LEADING_PHRASES = [
  'an image of',
  'a image of',
  'image of',
  'a picture of',
  'picture of',
  'a photo of',
  'photo of',
  'a photograph of',
  'a portrait of',
  'portrait of',
  'an illustration of',
  'a illustration of',
  'illustration of',
  'a drawing of',
  'drawing of',
  'a render of',
  'render of',
];

/**
 * Conectores que separan atributos en lenguaje natural. Se reemplazan por comas
 * para poder trocear el prompt en fragmentos. Llevan espacios alrededor para no
 * partir palabras (p. ej. "rain" no debe cortarse por "in").
 */
const CONNECTORS = [
  ' wearing ',
  ' dressed in ',
  ' with ',
  ' under ',
  ' at ',
  ' in front of ',
  ' next to ',
  ' beside ',
  ' near ',
  ' against ',
  ' surrounded by ',
  ' holding ',
  ' and ',
  ' in ',
  ' on ',
];

/** Artículos / muletillas que se eliminan dentro de cada fragmento. */
const FILLER_TOKENS = new Set([
  'a',
  'an',
  'the',
  'of',
  'that',
  'this',
  'is',
  'are',
  'was',
  'were',
  'be',
  'very',
  'really',
  'some',
  'to',
  'as',
  'it',
  'its',
  'their',
  'while',
]);

/** Sustantivos de sujeto / pronombres y adjetivos de edad que se descartan
 * (el género/conteo ya se captura aparte). */
const SUBJECT_TOKENS = new Set([
  'woman',
  'women',
  'girl',
  'girls',
  'man',
  'men',
  'boy',
  'boys',
  'female',
  'male',
  'lady',
  'ladies',
  'guy',
  'guys',
  'person',
  'people',
  'she',
  'he',
  'her',
  'his',
  'they',
  'young',
  'old',
  'adult',
  'teenage',
  'teenager',
]);

/** Tags de calidad/estilo seguros que se añaden (si no están ya presentes). */
const SAFE_QUALITY_TAGS = ['anime style', 'detailed eyes', 'high quality'];

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/** Detecta los tags de sujeto (género + conteo) sin inventar si no se indica. */
function detectSubjectTags(normalized: string): string[] {
  const femalePlural = /\b(women|girls|ladies)\b/.test(normalized);
  const malePlural = /\b(men|boys|guys)\b/.test(normalized);
  const femaleSingular = /\b(woman|girl|female|lady)\b/.test(normalized);
  const maleSingular = /\b(man|boy|male|guy)\b/.test(normalized);

  const count = (re: RegExp): number | null => {
    const m = normalized.match(re);
    if (!m) return null;
    const raw = m[1];
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    return NUMBER_WORDS[raw] ?? null;
  };

  if (femalePlural) {
    const n = count(/\b(\d+|one|two|three|four|five|six)\s+(?:women|girls|ladies)\b/);
    return n && n >= 2 ? [`${n}girls`] : ['multiple girls'];
  }
  if (malePlural) {
    const n = count(/\b(\d+|one|two|three|four|five|six)\s+(?:men|boys|guys)\b/);
    return n && n >= 2 ? [`${n}boys`] : ['multiple boys'];
  }
  if (femaleSingular) return ['1girl', 'solo'];
  if (maleSingular) return ['1boy', 'solo'];
  return [];
}

/** Limpia un fragmento a un tag: quita filler/sujeto y normaliza espacios. */
function fragmentToTag(fragment: string): string {
  const tokens = fragment
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !FILLER_TOKENS.has(t) && !SUBJECT_TOKENS.has(t));
  return tokens.join(' ').trim();
}

/** Dedup case-insensitive preservando el primer orden de aparición. */
function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

export function convertToAnillustriousTags(prompt: string): string {
  const original = (prompt ?? '').trim();

  // Normalización para el matching (no se devuelve).
  let working = original.toLowerCase();

  // Quitar frases introductorias.
  for (const phrase of LEADING_PHRASES) {
    if (working.startsWith(phrase + ' ')) {
      working = working.slice(phrase.length).trim();
      break;
    }
  }

  const subjectTags = detectSubjectTags(working);

  // Reemplazar conectores por comas y limpiar puntuación (excepto comas).
  let delimited = working;
  for (const connector of CONNECTORS) {
    delimited = delimited.split(connector).join(', ');
  }
  delimited = delimited.replace(/[^\p{L}\p{N},\s-]/gu, ' ');

  const contentTags = delimited
    .split(',')
    .map((fragment) => fragmentToTag(fragment))
    .filter(Boolean);

  let tags = dedupe([...subjectTags, ...contentTags]);

  // Asegurar salida usable incluso con entradas cortas/imperfectas.
  if (tags.length === 0) {
    const fallback = fragmentToTag(working.replace(/[^\p{L}\p{N}\s-]/gu, ' '));
    if (fallback) tags = [fallback];
  }

  // Añadir tags de calidad seguros (sin duplicar).
  tags = dedupe([...tags, ...SAFE_QUALITY_TAGS]);

  return tags.join(', ');
}

@Injectable()
export class AnillustriousPromptTransformer {
  convertToAnillustriousTags(prompt: string): string {
    return convertToAnillustriousTags(prompt);
  }
}
