import { Injectable } from '@nestjs/common';

/**
 * Transforma el prompt en lenguaje natural que arma el frontend (género/edad,
 * etnia/apariencia, personalidad, tono/iluminación, intereses/fondos, arquetipo,
 * intensidad, modo avatar/send_pic, reglas positivas y frases "No ...") en DOS
 * listas de tags canónicos estilo Danbooru: `positive` y `negative`.
 *
 * Es 100% determinista (sin red ni LLM) y NO muta su entrada. Vive separado de la
 * selección de provider y de la llamada a Replicate.
 *
 * Pipeline:
 *  1. Normalizar (Unicode, espacios, mayúsculas, puntuación, guiones).
 *  2. Extraer frases negativas (no/without/avoid/never/not …) → tags negativos.
 *  3. Detectar sujeto, género y cantidad.
 *  4. Aplicar aliases de frases largas a tags canónicos (consumo longest-first).
 *  5. Recuperar tags simples válidos restantes.
 *  6. Deduplicar y ordenar por categoría.
 *  7. Añadir `masterpiece` como primer tag.
 *  8. Construir positive y negative por separado.
 */

export interface AnillustriousPrompts {
  positive: string;
  negative: string;
}

type AliasEntry = [phrase: string, tags: string[]];

// ───────────────────────── Diccionarios ─────────────────────────

/** Único tag obligatorio; no introduce atributos visuales nuevos. */
const REQUIRED_POSITIVE_TAGS = ['masterpiece'];

/** Piso de seguridad NSFW + negativos globales (siempre presentes). */
const NSFW_FLOOR = ['nsfw', 'naked'];
const GLOBAL_NEGATIVE_TAGS = [
  'photorealistic',
  'realistic',
  '3d',
  'cgi',
  'plastic skin',
  'armor',
  'ornate clothes',
  'oil painting',
  'traditional media',
  'concept art',
  'chibi',
  'retro artstyle',
  'western cartoon',
  'sepia',
  'monochrome',
  'multiple views',
  'cloning',
  'duplicate',
  'comic',
  'panel layout',
  'collage',
  'border',
  'frame',
  'cropped',
  'bad anatomy',
  'bad hands',
  'extra arms',
  'extra legs',
  'extra hands',
  'extra fingers',
  'malformed limbs',
  'cross-eyed',
  'asymmetrical eyes',
  'text',
  'watermark',
  'signature',
  'logo',
  'interface',
  'ui',
];

const COMPOSITION_ANATOMY: AliasEntry[] = [
  ['single character only', ['solo']],
  ['single person only', ['solo']],
  ['upper body portrait', ['upper body']],
  ['three quarter portrait', ['cowboy shot']],
  ['portrait composition', ['portrait']],
  ['both eyes clearly visible', ['looking at viewer']],
  ['direct eye contact', ['looking at viewer']],
  ['detailed anime eyes', ['detailed anime eyes']],
  ['expressive anime eyes', ['detailed anime eyes']],
  ['glossy catchlights', ['eye reflection']],
  ['catchlights', ['eye reflection']],
  ['delicate eyelashes', ['eyelashes']],
  ['soft blush', ['blush']],
  ['layered hair', ['layered hair']],
  ['separated hair strands', ['hair strands']],
  ['crisp line art', ['lineart']],
  ['clean line art', ['lineart']],
  ['cel shading', ['cel shading']],
  ['soft gradient shadows', ['gradient shading']],
  ['cool rim light', ['rim lighting']],
  ['subtle rim light', ['rim lighting']],
  ['soft background depth', ['depth of field']],
  ['simple background shapes', ['simple background']],
];

const PERSONALITY_EXPRESSION: AliasEntry[] = [
  ['warm relaxed smile', ['smile', 'looking at viewer']],
  ['candid laugh', ['laughing', 'open mouth']],
  ['soft thoughtful expression', ['pensive', 'relaxed']],
  ['calm focused expression', ['serious', 'focused']],
  ['curious gaze', ['curious']],
  ['gentle caring expression', ['gentle smile', 'soft expression']],
  ['lively expression', ['energetic', 'smile']],
  ['energetic expression', ['energetic', 'smile']],
  [
    'soft expression and relaxed posture',
    ['soft expression', 'relaxed posture'],
  ],
  ['strong eye contact', ['looking at viewer', 'intense gaze']],
  ['confident but approachable', ['confident', 'smile']],
];

const LIGHTING_COLOR: AliasEntry[] = [
  ['warm neutral lighting', ['warm lighting']],
  ['peach highlights', ['peach lighting']],
  ['soft lighting', ['soft lighting']],
  ['cool blue violet lighting', ['cool lighting', 'blue lighting']],
  ['bright clean lighting', ['bright lighting']],
  ['dramatic lighting', ['dramatic lighting']],
  ['directional side light', ['side lighting']],
  ['vivid colors', ['vibrant colors']],
  ['saturated colors', ['vibrant colors']],
  ['crisp contrast', ['high contrast']],
  ['rim light', ['rim lighting']],
];

const SCENES_INTERESTS: AliasEntry[] = [
  ['modern anime room', ['indoors', 'desk', 'computer', 'monitor']],
  ['desk setup', ['indoors', 'desk', 'computer', 'monitor']],
  ['art studio', ['art studio', 'canvas', 'painting']],
  ['study room', ['study', 'books']],
  ['music room', ['music room', 'musical instrument']],
  ['reading room', ['library', 'bookshelf', 'books']],
  ['library', ['library', 'bookshelf', 'books']],
  ['evening city street', ['city street', 'outdoors', 'evening']],
  ['city street', ['city street', 'outdoors']],
  ['colorful signs', ['neon signs']],
  ['boutique lights', ['boutique', 'storefront', 'city lights']],
  ['sports field', ['sports field', 'outdoors']],
  ['high rise office', ['office', 'cityscape', 'window']],
  ['office interior', ['office']],
  ['woodworking workshop', ['workshop', 'wood', 'workbench', 'tools']],
  ['apartment studio', ['apartment', 'bookshelf', 'plant']],
  ['urban security setting', ['city street', 'outdoors']],
];

/** Ropa y props por arquetipo (Hostess, Executive female, Muse, Cheerleader,
 *  Executive male, Craftsman, Intellectual, Protector). */
const ARCHETYPE_CLOTHING_PROPS: AliasEntry[] = [
  // Hostess
  ['breakfast nook', ['breakfast', 'indoors']],
  ['breakfast table', ['breakfast', 'indoors']],
  ['coffee cup', ['coffee cup']],
  ['pastries', ['pastry']],
  ['flowers', ['flowers']],
  ['casual light toned outfit', ['casual clothes']],
  // Executive female
  ['white blouse', ['white blouse']],
  ['dark business skirt', ['pencil skirt']],
  ['tailored office outfit', ['business suit']],
  ['tablet', ['tablet computer']],
  ['folder', ['folder']],
  ['pen', ['pen']],
  // Muse
  ['bohemian outfit', ['bohemian fashion', 'layered clothes']],
  ['paintbrushes', ['paintbrush']],
  ['paintbrush', ['paintbrush']],
  ['sketchbook', ['sketchbook']],
  ['bracelets', ['bracelet']],
  // Cheerleader
  ['cheerleader inspired uniform', ['cheerleader', 'cheerleader outfit']],
  ['pom poms', ['pom pom']],
  ['athletic field', ['sports field', 'outdoors']],
  // Executive male
  ['tailored dark suit', ['business suit', 'black suit']],
  ['white shirt', ['white shirt']],
  ['dark tie', ['necktie']],
  ['pocket square', ['pocket square']],
  ['document folder', ['folder']],
  ['watch', ['wristwatch']],
  // Craftsman
  ['work shirt', ['work clothes']],
  ['workwear', ['work clothes']],
  ['leather apron', ['apron']],
  ['canvas apron', ['apron']],
  ['hand tool', ['holding tool']],
  ['workbench', ['workbench']],
  // Intellectual
  ['open book', ['open book']],
  ['acoustic guitar', ['acoustic guitar']],
  ['bookshelves', ['bookshelf']],
  ['overshirt', ['overshirt', 'layered clothes']],
  ['layered styling', ['layered clothes']],
  // Protector
  ['navy security uniform', ['security uniform', 'navy uniform']],
  ['utility belt', ['utility belt']],
  ['radio', ['radio']],
  ['sunglasses clipped to shirt', ['sunglasses']],
  ['sunglasses', ['sunglasses']],
];

/** Apariencia/etnia: solo rasgos explícitos. Los peinados afro/coils/locs/braids
 *  son alternativas mutuamente excluyentes (ver lógica de blacklist). */
const APPEARANCE_ETHNICITY: AliasEntry[] = [
  ['olive skin', ['olive skin']],
  ['tan skin', ['tan']],
  ['pale skin', ['pale skin']],
  ['fair skin', ['pale skin']],
  ['dark brown skin', ['deep brown skin']],
  ['deep brown skin', ['deep brown skin']],
  ['brown skin', ['brown skin']],
  ['dark skin', ['dark skin']],
  ['black hair', ['black hair']],
  ['straight hair', ['straight hair']],
  ['afro', ['afro']],
  ['coils', ['coiled hair']],
  ['locs', ['dreadlocks']],
  ['braids', ['braid']],
];

const EXCLUSIVE_HAIR_PHRASES = ['afro', 'coils', 'locs', 'braids'];

/** Frases que disparan tags NEGATIVOS específicos de arquetipo y se quitan del
 *  prompt positivo cuando aparecen. */
const ARCHETYPE_NEGATIVE_TRIGGERS: AliasEntry[] = [
  ['maid outfit', ['maid']],
  ['fanservice', ['fanservice']],
  ['school logo', ['school emblem', 'logo']],
  ['revealing outfit', ['revealing clothes']],
  ['sexualized posing', ['suggestive pose']],
  ['villain expression', ['evil smile']],
  ['wizard look', ['wizard']],
  ['school uniform', ['school uniform']],
  ['weapons drawn', ['gun', 'holding weapon']],
  ['military armor', ['military uniform', 'armor']],
  ['aggressive stance', ['aggressive']],
];

/** Aliases de instrucciones negativas (no …) → tags negativos. */
const NEGATIVE_ALIASES: AliasEntry[] = [
  ['no cropped duplicate body parts', ['cropped', 'duplicate']],
  ['no asymmetrical face distortion', ['asymmetrical eyes', 'bad anatomy']],
  ['no duplicate faces', ['duplicate', 'cloning']],
  ['no duplicate characters', ['duplicate', 'cloning']],
  ['no side panels', ['panel layout', 'comic']],
  ['no panels', ['panel layout', 'comic']],
  ['no interface overlay', ['interface', 'ui']],
  ['no ui overlay', ['interface', 'ui']],
  ['no malformed eyes', ['malformed eyes']],
  ['no extra limbs', ['extra arms', 'extra legs']],
  ['no extra hands', ['extra hands']],
  ['no photorealism', ['photorealistic', 'realistic']],
  ['no 3d render', ['3d', 'cgi']],
  ['no cgi', ['3d', 'cgi']],
  ['no 3d', ['3d']],
  ['no fantasy armor', ['armor']],
  ['no oil painting look', ['oil painting', 'traditional media']],
  ['no painterly look', ['oil painting', 'traditional media']],
  ['no old school anime', ['retro artstyle']],
  ['no western cartoon', ['western cartoon']],
  ['no decorative frame', ['frame', 'border']],
  ['no framing marks', ['frame', 'border']],
  ['no chibi style', ['chibi']],
  ['no chibi', ['chibi']],
  ['no collage', ['collage']],
  ['no watermark', ['watermark']],
  ['no logos', ['logo']],
  ['no logo', ['logo']],
  ['no text', ['text']],
];

const NEGATIVE_STARTERS = ['no ', 'without ', 'avoid ', 'never ', 'not '];
const NEGATIVE_INSTRUCTION_STARTERS = [
  'should not ',
  'must not ',
  ...NEGATIVE_STARTERS,
];

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
  'who',
  'such',
  'especially',
  'should',
  'must',
  'have',
  'include',
  'show',
  'display',
]);

const DANGLING_TOKENS = new Set([
  'and',
  'or',
  'such',
  'especially',
  'should',
  'must',
]);

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
  'androgynous',
  'adult',
  'young',
  'old',
]);

/** Conectores en lenguaje natural → separador de fragmentos en la recuperación. */
const CONNECTORS = [
  ' wearing ',
  ' dressed in ',
  ' with ',
  ' featuring ',
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

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

type PositiveCategory =
  | 'composition'
  | 'appearance'
  | 'expression'
  | 'hairEyes'
  | 'clothing'
  | 'lighting'
  | 'style'
  | 'background';

interface ReductionRule {
  phrase: string;
  category: PositiveCategory;
  tags: string[];
}

const POSITIVE_REDUCTIONS: ReductionRule[] = [
  {
    phrase: 'modern high quality anime character illustration',
    category: 'style',
    tags: ['high quality', 'modern anime illustration'],
  },
  {
    phrase:
      'expressive detailed anime eyes with layered iris colors, glossy highlights, and subtle reflective depth',
    category: 'hairEyes',
    tags: ['detailed anime eyes', 'layered irises', 'glossy highlights'],
  },
  {
    phrase:
      'dynamic layered hair silhouette with many separated strands, sharp highlights, and deep shadow shapes',
    category: 'hairEyes',
    tags: [
      'layered hair',
      'separated strands',
      'sharp highlights',
      'deep shadows',
    ],
  },
  {
    phrase: 'clean stylized neck and shoulder proportions',
    category: 'appearance',
    tags: ['natural neck and shoulder proportions'],
  },
  {
    phrase:
      'polished high detail modern anime key visual style, contemporary anime character art',
    category: 'style',
    tags: ['polished modern anime key visual'],
  },
  {
    phrase: 'black african descent, deep dark brown or rich tone',
    category: 'appearance',
    tags: ['black woman', 'african descent', 'deep brown skin'],
  },
  {
    phrase:
      'stylish contemporary casual outfit, such fitted jacket, soft knit sweater, simple blouse, hoodie, or modern streetwear inspired top',
    category: 'clothing',
    tags: [
      'contemporary casual outfit',
      'jacket',
      'sweater',
      'blouse',
      'hoodie',
    ],
  },
  {
    phrase: 'modern anime character illustration',
    category: 'style',
    tags: ['modern anime illustration'],
  },
  {
    phrase: 'contemporary anime character art',
    category: 'style',
    tags: ['modern anime illustration'],
  },
];

const EQUIVALENT_TAG_GROUPS: string[][] = [
  [
    'polished modern anime key visual',
    'modern anime illustration',
    'modern anime',
    'anime',
  ],
  ['detailed anime eyes', 'detailed eyes', 'expressive anime eyes'],
  ['deep brown skin', 'dark brown skin', 'dark skin', 'brown skin'],
  ['vibrant colors', 'colorful', 'saturated colors', 'vivid colors'],
  ['lineart', 'clean line art', 'crisp line art'],
];

// ───────────────────────── Helpers ─────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex con límites de palabra para una frase (ya normalizada). */
function phraseRegex(phrase: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'g');
}

function hasPhrase(text: string, phrase: string): boolean {
  return phraseRegex(phrase).test(text);
}

/** Dedup case-insensitive preservando el primer orden de aparición. */
function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

function dedupeEquivalent(tags: string[]): string[] {
  const out: string[] = [];
  const groupPositions = new Map<number, number>();
  const groupRanks = new Map<number, number>();

  for (const tag of dedupe(tags)) {
    const key = tag.toLowerCase();
    const groupIndex = EQUIVALENT_TAG_GROUPS.findIndex((group) =>
      group.includes(key),
    );

    if (groupIndex === -1) {
      out.push(tag);
      continue;
    }

    const rank = EQUIVALENT_TAG_GROUPS[groupIndex].indexOf(key);
    const position = groupPositions.get(groupIndex);
    if (position === undefined) {
      groupPositions.set(groupIndex, out.length);
      groupRanks.set(groupIndex, rank);
      out.push(tag);
      continue;
    }

    if (rank < (groupRanks.get(groupIndex) ?? Number.MAX_SAFE_INTEGER)) {
      out[position] = tag;
      groupRanks.set(groupIndex, rank);
    }
  }

  return out;
}

/** Parte una cadena de tags separada por comas en tags individuales. */
export function splitTags(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalize(prompt: string): string {
  return (prompt ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-/]/g, ' ') // guiones y barras → espacio
    .replace(/[.;\n]+/g, ',') // fin de cláusula → coma
    .replace(/[^\p{L}\p{N},\s]/gu, ' ') // resto de puntuación fuera
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSubject(text: string): { tags: string[]; total: number } {
  const num = (word: string): number | null => {
    if (/^\d+$/.test(word)) return parseInt(word, 10);
    return NUMBER_WORDS[word] ?? null;
  };

  const femPlural = text.match(
    /\b(\d+|one|two|three|four|five|six|multiple)\s+(?:women|girls|ladies)\b/,
  );
  const malPlural = text.match(
    /\b(\d+|one|two|three|four|five|six|multiple)\s+(?:men|boys|guys)\b/,
  );
  const femSingular = /\b(?:woman|girl|female|lady)\b/.test(text);
  const malSingular = /\b(?:man|boy|male|guy)\b/.test(text);
  const androgynous = /\bandrogynous\b/.test(text);

  let femaleTag: string | null = null;
  let femaleCount = 0;
  if (femPlural) {
    if (femPlural[1] === 'multiple') {
      femaleTag = 'multiple girls';
      femaleCount = 2;
    } else {
      const n = num(femPlural[1]);
      if (n && n >= 2) {
        femaleTag = `${n}girls`;
        femaleCount = n;
      } else if (n === 1 || femSingular) {
        femaleTag = '1girl';
        femaleCount = 1;
      }
    }
  } else if (femSingular) {
    femaleTag = '1girl';
    femaleCount = 1;
  }

  let maleTag: string | null = null;
  let maleCount = 0;
  if (malPlural) {
    if (malPlural[1] === 'multiple') {
      maleTag = 'multiple boys';
      maleCount = 2;
    } else {
      const n = num(malPlural[1]);
      if (n && n >= 2) {
        maleTag = `${n}boys`;
        maleCount = n;
      } else if (n === 1 || malSingular) {
        maleTag = '1boy';
        maleCount = 1;
      }
    }
  } else if (malSingular) {
    maleTag = '1boy';
    maleCount = 1;
  }

  if (androgynous && !femaleTag && !maleTag) {
    return { tags: ['solo', 'androgynous', 'adult'], total: 1 };
  }

  const tags: string[] = [];
  if (femaleTag) tags.push(femaleTag);
  if (maleTag) tags.push(maleTag);
  const total = femaleCount + maleCount;

  // `solo` + `adult` solo cuando hay exactamente un sujeto singular.
  if (total === 1 && (femaleTag === '1girl' || maleTag === '1boy')) {
    tags.push('solo', 'adult');
  }
  return { tags, total };
}

function stripSubjectWords(text: string): string {
  return text
    .replace(/\bandrogynous person\b/g, ' ')
    .replace(
      /\b(?:\d+|one|two|three|four|five|six|multiple)\s+(?:women|girls|ladies|men|boys|guys)\b/g,
      ' ',
    )
    .replace(
      /\b(?:women|woman|girls|girl|men|man|boys|boy|female|male|lady|ladies|guys|guy|androgynous|young adult|adult|young)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function fragmentToTag(fragment: string): string {
  const tokens = fragment
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !FILLER_TOKENS.has(t) && !SUBJECT_TOKENS.has(t));

  while (tokens.length && DANGLING_TOKENS.has(tokens[0])) tokens.shift();
  while (tokens.length && DANGLING_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ').trim();
}

function classifyTag(tag: string): PositiveCategory {
  if (
    /\b(?:portrait|upper body|cowboy shot|looking at viewer|eye contact|pose|posture|proportions)\b/.test(
      tag,
    )
  ) {
    return 'composition';
  }
  if (
    /\b(?:skin|descent|african|tan|pale|neck|shoulder|body|face)\b/.test(tag)
  ) {
    return 'appearance';
  }
  if (
    /\b(?:smile|laughing|mouth|pensive|relaxed|serious|focused|curious|expression|confident|gaze|energetic)\b/.test(
      tag,
    )
  ) {
    return 'expression';
  }
  if (/\b(?:hair|eye|eyes|iris|irises|eyelashes|strands)\b/.test(tag)) {
    return 'hairEyes';
  }
  if (
    /\b(?:outfit|clothes|shirt|blouse|skirt|suit|jacket|sweater|hoodie|uniform|apron|fashion|tie|overshirt|bracelet|watch|belt)\b/.test(
      tag,
    )
  ) {
    return 'clothing';
  }
  if (
    /\b(?:lighting|light|highlights|shadows|contrast|colors|colorful)\b/.test(
      tag,
    )
  ) {
    return 'lighting';
  }
  if (
    /\b(?:anime|illustration|key visual|lineart|cel shading|gradient shading|quality|artstyle|polished)\b/.test(
      tag,
    )
  ) {
    return 'style';
  }
  return 'background';
}

function orderPositiveTags(
  subjectTags: string[],
  tags: string[],
  categoryOverrides: Map<string, PositiveCategory>,
): string[] {
  const categories: Record<PositiveCategory, string[]> = {
    composition: [],
    appearance: [],
    expression: [],
    hairEyes: [],
    clothing: [],
    lighting: [],
    style: [],
    background: [],
  };

  for (const tag of tags) {
    const category =
      categoryOverrides.get(tag.toLowerCase()) ?? classifyTag(tag);
    categories[category].push(tag);
  }

  return dedupeEquivalent([
    ...REQUIRED_POSITIVE_TAGS,
    ...subjectTags,
    ...categories.composition,
    ...categories.appearance,
    ...categories.expression,
    ...categories.hairEyes,
    ...categories.clothing,
    ...categories.lighting,
    ...categories.style,
    ...categories.background,
  ]);
}

// ───────────────────────── Pipeline ─────────────────────────

export function transformAnillustriousPrompt(
  prompt: string,
): AnillustriousPrompts {
  let working = normalize(prompt);
  const negativeTags: string[] = [];

  // 2) Aliases negativos (longest-first) → consumir + acumular negativos.
  for (const [phrase, tags] of [...NEGATIVE_ALIASES].sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (hasPhrase(working, phrase)) {
      negativeTags.push(...tags);
      working = working.replace(phraseRegex(phrase), ' ');
    }
  }

  // 2b) Triggers negativos de arquetipo (presencia → avoid-tags, quitar del positivo).
  for (const [phrase, tags] of [...ARCHETYPE_NEGATIVE_TRIGGERS].sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (hasPhrase(working, phrase)) {
      negativeTags.push(...tags);
      working = working.replace(phraseRegex(phrase), ' ');
    }
  }

  // 2c) Barrido genérico: mover instrucciones negativas fuera del positivo.
  const positiveSegments: string[] = [];
  for (const rawSegment of working.split(',')) {
    const segment = rawSegment.trim();
    const starter = NEGATIVE_INSTRUCTION_STARTERS.find((candidate) =>
      segment.startsWith(candidate),
    );
    if (!starter) {
      positiveSegments.push(segment);
      continue;
    }

    const negativeTag = fragmentToTag(segment.slice(starter.length));
    if (negativeTag) negativeTags.push(negativeTag);
  }
  working = positiveSegments.filter(Boolean).join(', ');

  // 3) Sujeto / género / cantidad.
  const subject = detectSubject(working);
  working = stripSubjectWords(working);

  const reducedTags: string[] = [];
  const categoryOverrides = new Map<string, PositiveCategory>();
  for (const rule of [...POSITIVE_REDUCTIONS].sort(
    (a, b) => b.phrase.length - a.phrase.length,
  )) {
    if (!hasPhrase(working, rule.phrase)) continue;
    reducedTags.push(...rule.tags);
    for (const tag of rule.tags) {
      categoryOverrides.set(tag.toLowerCase(), rule.category);
    }
    working = working.replace(phraseRegex(rule.phrase), ' ');
  }

  // 4) Aliases positivos (longest-first global; buckets por categoría para el orden).
  const exclusiveHairBlacklisted =
    / or /.test(working) &&
    EXCLUSIVE_HAIR_PHRASES.filter((p) => hasPhrase(working, p)).length >= 2;

  const categories: { name: string; entries: AliasEntry[] }[] = [
    { name: 'composition', entries: COMPOSITION_ANATOMY },
    { name: 'appearance', entries: APPEARANCE_ETHNICITY },
    { name: 'expression', entries: PERSONALITY_EXPRESSION },
    { name: 'archetype', entries: ARCHETYPE_CLOTHING_PROPS },
    { name: 'scene', entries: SCENES_INTERESTS },
    { name: 'lighting', entries: LIGHTING_COLOR },
  ];

  const buckets: Record<string, string[]> = {};
  for (const c of categories) buckets[c.name] = [];

  // Lista plana ordenada por longitud de frase desc para consumo longest-first.
  const flat = categories.flatMap((c) =>
    c.entries.map((e) => ({ category: c.name, phrase: e[0], tags: e[1] })),
  );
  flat.sort((a, b) => b.phrase.length - a.phrase.length);

  for (const entry of flat) {
    if (!hasPhrase(working, entry.phrase)) continue;

    const isExclusiveHair = EXCLUSIVE_HAIR_PHRASES.includes(entry.phrase);
    if (isExclusiveHair && exclusiveHairBlacklisted) {
      working = working.replace(phraseRegex(entry.phrase), ' '); // consumir, no emitir
      continue;
    }

    buckets[entry.category].push(...entry.tags);
    working = working.replace(phraseRegex(entry.phrase), ' ');
  }

  // 5) Recuperar tags simples restantes.
  let recoveryText = ` ${working} `;
  for (const connector of CONNECTORS) {
    recoveryText = recoveryText.split(connector).join(', ');
  }
  const recovered = recoveryText
    .split(',')
    .map((frag) => fragmentToTag(frag))
    .filter(Boolean);

  // 6) Ensamblar, deduplicar y ordenar por categoría.
  const generatedTags = dedupe([
    ...reducedTags,
    ...buckets.composition,
    ...buckets.appearance,
    ...buckets.expression,
    ...buckets.archetype,
    ...buckets.scene,
    ...buckets.lighting,
    ...recovered,
  ]);
  const positive = orderPositiveTags(
    subject.tags,
    generatedTags,
    categoryOverrides,
  );

  // 8) Negativo: piso NSFW + globales + extraídos/arquetipo.
  const negative = dedupe([
    ...NSFW_FLOOR,
    ...GLOBAL_NEGATIVE_TAGS,
    ...negativeTags,
  ]);

  return {
    positive: positive.join(', '),
    negative: negative.join(', '),
  };
}

/** Compatibilidad: devuelve solo el prompt positivo. */
export function convertToAnillustriousTags(prompt: string): string {
  return transformAnillustriousPrompt(prompt).positive;
}

@Injectable()
export class AnillustriousPromptTransformer {
  transform(prompt: string): AnillustriousPrompts {
    return transformAnillustriousPrompt(prompt);
  }

  convertToAnillustriousTags(prompt: string): string {
    return convertToAnillustriousTags(prompt);
  }
}
