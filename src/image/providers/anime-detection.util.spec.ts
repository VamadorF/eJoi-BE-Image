import { isAnimePrompt } from './anime-detection.util';

describe('isAnimePrompt', () => {
  it('detecta keywords de anime en inglés', () => {
    expect(isAnimePrompt('a beautiful anime girl')).toBe(true);
    expect(isAnimePrompt('chibi cat')).toBe(true);
    expect(isAnimePrompt('portrait with cel shading')).toBe(true);
  });

  it('es case-insensitive', () => {
    expect(isAnimePrompt('ESTILO MANGA retrato')).toBe(true);
    expect(isAnimePrompt('AnImE eyes closeup')).toBe(true);
  });

  it('detecta tags con dígitos y frases con acentos', () => {
    expect(isAnimePrompt('1girl, solo')).toBe(true);
    expect(isAnimePrompt('1boy looking at viewer')).toBe(true);
    expect(isAnimePrompt('una ilustración anime de un dragón')).toBe(true);
  });

  it('devuelve false para prompts no anime', () => {
    expect(isAnimePrompt('a realistic photo of a mountain')).toBe(false);
    expect(isAnimePrompt('un retrato fotográfico de un perro')).toBe(false);
  });

  it('devuelve false para entrada vacía o nula', () => {
    expect(isAnimePrompt('')).toBe(false);
    expect(isAnimePrompt(undefined as unknown as string)).toBe(false);
  });
});
