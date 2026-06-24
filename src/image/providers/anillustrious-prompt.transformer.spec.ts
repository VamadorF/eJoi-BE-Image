import {
  AnillustriousPromptTransformer,
  convertToAnillustriousTags,
} from './anillustrious-prompt.transformer';

describe('convertToAnillustriousTags', () => {
  it('convierte el ejemplo de referencia a tags Danbooru', () => {
    const input =
      'A young woman with long black hair wearing a red dress, standing under cherry blossoms at sunset';
    const out = convertToAnillustriousTags(input);

    expect(out).toBe(
      '1girl, solo, long black hair, red dress, standing, cherry blossoms, sunset, anime style, detailed eyes, high quality',
    );
  });

  it('produce una salida separada por comas (lista de tags)', () => {
    const out = convertToAnillustriousTags('an anime boy with spiky blue hair');
    const tags = out.split(',').map((t) => t.trim());
    expect(tags).toContain('1boy');
    expect(tags).toContain('solo');
    expect(tags).toContain('spiky blue hair');
  });

  it('preserva atributos explícitos (género, pelo, ropa, lugar)', () => {
    const out = convertToAnillustriousTags(
      'A man with short brown hair wearing a black suit in a neon city',
    );
    expect(out).toContain('1boy');
    expect(out).toContain('short brown hair');
    expect(out).toContain('black suit');
    expect(out).toContain('neon city');
  });

  it('elimina muletillas / frases introductorias', () => {
    const out = convertToAnillustriousTags(
      'a photo of a girl with green eyes',
    );
    // "a photo of" desaparece; no quedan artículos sueltos como tags.
    const tags = out.split(',').map((t) => t.trim());
    expect(tags).not.toContain('a');
    expect(tags).not.toContain('photo of');
    expect(tags).toContain('green eyes');
    expect(tags).toContain('1girl');
  });

  it('añade tags de calidad seguros una sola vez (sin duplicar)', () => {
    const out = convertToAnillustriousTags('anime girl, high quality');
    const occurrences = out
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t === 'high quality').length;
    expect(occurrences).toBe(1);
    expect(out).toContain('anime style');
    expect(out).toContain('detailed eyes');
  });

  it('no inventa género cuando no se indica', () => {
    const out = convertToAnillustriousTags('a red sports car on a highway');
    expect(out).not.toContain('1girl');
    expect(out).not.toContain('1boy');
    expect(out).toContain('red sports car');
  });

  it('soporta conteo de personajes', () => {
    expect(convertToAnillustriousTags('two girls dancing')).toContain('2girls');
  });

  it('devuelve una salida usable con entradas cortas o imperfectas', () => {
    const out = convertToAnillustriousTags('!!!');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('anime style');
  });

  it('no rompe con string vacío', () => {
    const out = convertToAnillustriousTags('');
    expect(out).toContain('anime style');
  });
});

describe('AnillustriousPromptTransformer (injectable)', () => {
  it('delega en convertToAnillustriousTags', () => {
    const t = new AnillustriousPromptTransformer();
    expect(t.convertToAnillustriousTags('an anime girl')).toBe(
      convertToAnillustriousTags('an anime girl'),
    );
  });
});
