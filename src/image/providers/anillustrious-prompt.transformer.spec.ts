import {
  AnillustriousPromptTransformer,
  transformAnillustriousPrompt,
  convertToAnillustriousTags,
} from './anillustrious-prompt.transformer';

/** Helpers para aserciones sobre listas de tags. */
const posTags = (prompt: string) =>
  transformAnillustriousPrompt(prompt)
    .positive.split(',')
    .map((t) => t.trim());
const negTags = (prompt: string) =>
  transformAnillustriousPrompt(prompt)
    .negative.split(',')
    .map((t) => t.trim());

describe('transformAnillustriousPrompt — sujeto / género / cantidad', () => {
  it('woman → 1girl, solo, adult', () => {
    const t = posTags('a woman with black hair');
    expect(t).toEqual(expect.arrayContaining(['1girl', 'solo', 'adult']));
  });

  it('man → 1boy, solo, adult', () => {
    const t = posTags('a man in a business suit');
    expect(t).toEqual(expect.arrayContaining(['1boy', 'solo', 'adult']));
  });

  it('androgynous person → solo, androgynous, adult', () => {
    const t = posTags('an androgynous person standing');
    expect(t).toEqual(expect.arrayContaining(['solo', 'androgynous', 'adult']));
    expect(t).not.toContain('1girl');
    expect(t).not.toContain('1boy');
  });

  it('mixto: one woman and one man → 1girl, 1boy y SIN solo', () => {
    const t = posTags('one woman and one man talking');
    expect(t).toContain('1girl');
    expect(t).toContain('1boy');
    expect(t).not.toContain('solo');
  });

  it('two women → 2girls; three men → 3boys; multiple → multiple girls/boys', () => {
    expect(posTags('two women dancing')).toContain('2girls');
    expect(posTags('three men walking')).toContain('3boys');
    expect(posTags('multiple women')).toContain('multiple girls');
    expect(posTags('multiple men')).toContain('multiple boys');
    expect(posTags('two women dancing')).not.toContain('solo');
  });

  it('no inventa género cuando no se indica', () => {
    const t = posTags('a red sports car on a highway');
    expect(t).not.toContain('1girl');
    expect(t).not.toContain('1boy');
    expect(t).toContain('red sports car');
  });
});

describe('transformAnillustriousPrompt — aliases por categoría', () => {
  it('composición/anatomía', () => {
    const t = posTags(
      'upper-body portrait, cel shading, both eyes clearly visible',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        'upper body',
        'cel shading',
        'looking at viewer',
      ]),
    );
  });

  it('expresión/personalidad', () => {
    const t = posTags('a woman with a warm relaxed smile');
    expect(t).toEqual(expect.arrayContaining(['smile', 'looking at viewer']));
  });

  it('iluminación/color', () => {
    const t = posTags('warm-neutral lighting and vivid colors');
    expect(t).toEqual(
      expect.arrayContaining(['warm lighting', 'vibrant colors']),
    );
    expect(t).not.toContain('colorful');
  });

  it('escenas/intereses (longest-first, sin duplicar)', () => {
    const t = posTags('evening city street with colorful signs');
    expect(t).toEqual(
      expect.arrayContaining([
        'city street',
        'outdoors',
        'evening',
        'neon signs',
      ]),
    );
  });

  it('arquetipo: ropa y props', () => {
    const t = posTags('cheerleader-inspired uniform with pom-poms');
    expect(t).toEqual(
      expect.arrayContaining(['cheerleader', 'cheerleader outfit', 'pom pom']),
    );
  });
});

describe('transformAnillustriousPrompt — apariencia/etnia y exclusión mutua', () => {
  it('mapea solo rasgos explícitos', () => {
    const t = posTags('olive skin, black hair, straight hair');
    expect(t).toEqual(
      expect.arrayContaining(['olive skin', 'black hair', 'straight hair']),
    );
  });

  it('peinados afro/coils/locs/braids enumerados ⇒ no emite ninguno', () => {
    const t = posTags(
      'dark brown skin, black hair, afro, coils, locs, or braids',
    );
    expect(t).toEqual(
      expect.arrayContaining(['deep brown skin', 'black hair']),
    );
    expect(t).not.toContain('afro');
    expect(t).not.toContain('braid');
    expect(t).not.toContain('dreadlocks');
    expect(t).not.toContain('coiled hair');
  });

  it('peinado concreto (no enumerado) sí se mapea', () => {
    expect(posTags('long braids')).toContain('braid');
  });
});

describe('transformAnillustriousPrompt — negativos', () => {
  it('extrae instrucciones "no ..." al negativo y las quita del positivo', () => {
    const { positive, negative } = transformAnillustriousPrompt(
      'an anime girl, no text, no watermark, no malformed eyes',
    );
    expect(negative).toContain('text');
    expect(negative).toContain('watermark');
    expect(negative).toContain('malformed eyes');
    expect(positive).not.toContain('no text');
    expect(positive.split(',').map((s) => s.trim())).not.toContain('text');
  });

  it('siempre incluye el piso NSFW y los negativos globales', () => {
    const n = negTags('a woman');
    expect(n).toEqual(
      expect.arrayContaining([
        'nsfw',
        'naked',
        'photorealistic',
        'realistic',
        '3d',
        'cgi',
        'text',
        'watermark',
      ]),
    );
  });

  it('triggers de arquetipo van al negativo y se quitan del positivo', () => {
    const { positive, negative } = transformAnillustriousPrompt(
      'an anime girl in a maid outfit',
    );
    expect(negative).toContain('maid');
    expect(positive).not.toContain('maid');
  });
});

describe('transformAnillustriousPrompt — base, dedupe y robustez', () => {
  it('añade masterpiece primero y no inventa atributos base', () => {
    const out = transformAnillustriousPrompt(
      'anime girl, high quality',
    ).positive;
    const tags = out.split(',').map((t) => t.trim());
    expect(tags[0]).toBe('masterpiece');
    expect(tags.filter((t) => t === 'high quality')).toHaveLength(1);
    expect(tags).toEqual(expect.arrayContaining(['anime', 'high quality']));
    expect(tags).not.toContain('detailed eyes');
  });

  it('devuelve salida usable con entrada vacía o imperfecta', () => {
    expect(posTags('')).toEqual(['masterpiece']);
    expect(posTags('!!!')).toEqual(['masterpiece']);
  });
});

describe('transformAnillustriousPrompt — simplificación de tags', () => {
  it.each([
    [
      'modern high quality anime character illustration',
      ['masterpiece', 'high quality', 'modern anime illustration'],
    ],
    [
      'expressive detailed anime eyes with layered iris colors, glossy highlights, and subtle reflective depth',
      [
        'masterpiece',
        'detailed anime eyes',
        'layered irises',
        'glossy highlights',
      ],
    ],
    [
      'dynamic layered hair silhouette with many separated strands, sharp highlights, and deep shadow shapes',
      [
        'masterpiece',
        'layered hair',
        'separated strands',
        'sharp highlights',
        'deep shadows',
      ],
    ],
    [
      'clean stylized neck and shoulder proportions',
      ['masterpiece', 'natural neck and shoulder proportions'],
    ],
    [
      'polished high detail modern anime key visual style, contemporary anime character art',
      ['masterpiece', 'polished modern anime key visual'],
    ],
    [
      'black african descent, deep dark brown or rich tone',
      ['masterpiece', 'black woman', 'african descent', 'deep brown skin'],
    ],
    [
      'stylish contemporary casual outfit, such fitted jacket, soft knit sweater, simple blouse, hoodie, or modern streetwear inspired top',
      [
        'masterpiece',
        'contemporary casual outfit',
        'jacket',
        'sweater',
        'blouse',
        'hoodie',
      ],
    ],
  ])('reduce frases largas sin cambiar su intención', (input, expected) => {
    expect(posTags(input)).toEqual(expected);
  });

  it('deduplica tags exactos y casi equivalentes conservando el más específico', () => {
    expect(
      posTags(
        'modern anime, modern anime illustration, modern high quality anime character illustration',
      ),
    ).toEqual(['masterpiece', 'high quality', 'modern anime illustration']);
  });

  it('elimina fragmentos de conectores e instrucciones sin dejar tags rotos', () => {
    const tags = posTags('a woman, such, or, especially, should, must');
    expect(tags).toEqual(['masterpiece', '1girl', 'solo', 'adult']);
    for (const fragment of ['such', 'or', 'especially', 'should', 'must']) {
      expect(tags).not.toContain(fragment);
    }
  });

  it('conserva negaciones importantes al limpiar instrucciones', () => {
    const { positive, negative } = transformAnillustriousPrompt(
      'a woman, must not show red eyes',
    );
    expect(positive).not.toContain('red eyes');
    expect(negative.split(',').map((tag) => tag.trim())).toContain('red eyes');
  });
});

describe('AnillustriousPromptTransformer (injectable)', () => {
  it('transform delega en la función pura', () => {
    const t = new AnillustriousPromptTransformer();
    expect(t.transform('an anime girl')).toEqual(
      transformAnillustriousPrompt('an anime girl'),
    );
  });

  it('convertToAnillustriousTags devuelve solo el positivo', () => {
    const t = new AnillustriousPromptTransformer();
    expect(t.convertToAnillustriousTags('an anime girl')).toBe(
      convertToAnillustriousTags('an anime girl'),
    );
  });
});
