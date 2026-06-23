import { AnimePromptDetector, ANIME_KEYWORDS } from './anime-prompt.detector';

describe('AnimePromptDetector', () => {
  const detector = new AnimePromptDetector();

  it('detecta cada keyword explícito dentro de una frase', () => {
    for (const keyword of ANIME_KEYWORDS) {
      const prompt = `a beautiful ${keyword} scene with detail`;
      expect(detector.isAnimePrompt(prompt)).toBe(true);
    }
  });

  it('es case-insensitive', () => {
    expect(detector.isAnimePrompt('An AMAZING ANIME girl')).toBe(true);
    expect(detector.isAnimePrompt('Manga STYLE Cover')).toBe(true);
    expect(detector.isAnimePrompt('Cel Shading look')).toBe(true);
    expect(detector.isAnimePrompt('JAPANESE ANIMATION still')).toBe(true);
  });

  it('normaliza espacios al inicio/fin (trim)', () => {
    expect(detector.isAnimePrompt('   anime   ')).toBe(true);
    expect(detector.isAnimePrompt('\n\twaifu\n')).toBe(true);
  });

  it('NO clasifica como anime palabras ambiguas por sí solas', () => {
    expect(detector.isAnimePrompt('a detailed illustration of a city')).toBe(false);
    expect(detector.isAnimePrompt('a funny cartoon dog')).toBe(false);
    expect(detector.isAnimePrompt('a pencil drawing of a tree')).toBe(false);
    expect(detector.isAnimePrompt('a character standing in a field')).toBe(false);
  });

  it('NO clasifica prompts realistas', () => {
    expect(
      detector.isAnimePrompt('a photorealistic portrait of an old man, 85mm'),
    ).toBe(false);
    expect(detector.isAnimePrompt('a cyberpunk neon sign that says eJoi')).toBe(
      false,
    );
  });

  it('prefiere anime cuando se mezclan instrucciones realistas y anime', () => {
    expect(
      detector.isAnimePrompt(
        'a photorealistic cityscape rendered as an anime illustration',
      ),
    ).toBe(true);
    expect(
      detector.isAnimePrompt('hyperrealistic skin, but in manga style'),
    ).toBe(true);
  });

  it('maneja entradas vacías / inválidas sin lanzar', () => {
    expect(detector.isAnimePrompt('')).toBe(false);
    expect(detector.isAnimePrompt('   ')).toBe(false);
    expect(detector.isAnimePrompt(undefined as unknown as string)).toBe(false);
  });

  it('respeta límites de palabra (no matchea subcadenas accidentales)', () => {
    // "shonen" no debería matchear dentro de otra palabra pegada.
    expect(detector.isAnimePrompt('preshonenade')).toBe(false);
    // pero sí como palabra independiente
    expect(detector.isAnimePrompt('a shonen hero')).toBe(true);
  });
});
