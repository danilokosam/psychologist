import { describe, expect, it } from 'vitest';
import { organizationSlug } from './account';

describe('organizationSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(organizationSlug('My Private Practice', 'abc12345')).toBe(
      'my-private-practice-abc12345',
    );
  });

  it('folds Spanish accents instead of dropping the letters', () => {
    // The failure this guards against: "consulta-de-jos-muoz".
    expect(organizationSlug('Consulta de José Muñoz', 'abc12345')).toBe(
      'consulta-de-jose-munoz-abc12345',
    );
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(organizationSlug('  Psicología & Terapia!!  ', 'abc12345')).toBe(
      'psicologia-terapia-abc12345',
    );
  });

  it('falls back when the name has no usable characters', () => {
    expect(organizationSlug('???', 'abc12345')).toBe('practice-abc12345');
  });

  it('never ends with a hyphen even when the name is truncated', () => {
    const slug = organizationSlug('a'.repeat(39) + ' overflow', 'abc12345');

    expect(slug.endsWith('-abc12345')).toBe(true);
    expect(slug).not.toContain('--');
  });
});
