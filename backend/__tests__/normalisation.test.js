const { normalise, fallbacks } = require('../src/services/normalisationService');

describe('normalise()', () => {
  test('lowercases the input', () => {
    expect(normalise('Running')).toBe('running');
  });

  test('strips punctuation', () => {
    expect(normalise('word,')).toBe('word');
    expect(normalise('"hello"')).toBe('hello');
  });

  test('strips non-alphabetic characters', () => {
    expect(normalise('café')).toBe('caf');
    expect(normalise('123abc')).toBe('abc');
  });

  test('returns empty string for all non-alpha input', () => {
    expect(normalise('123')).toBe('');
    expect(normalise('---')).toBe('');
  });
});

describe('fallbacks()', () => {
  test('first candidate is always the lemma itself', () => {
    const result = fallbacks('run');
    expect(result[0]).toBe('run');
  });

  test('-ies → -y (studies → study)', () => {
    expect(fallbacks('studies')).toContain('study');
  });

  test('-es stripping (boxes → box)', () => {
    expect(fallbacks('boxes')).toContain('box');
  });

  test('-s stripping (cats → cat)', () => {
    expect(fallbacks('cats')).toContain('cat');
  });

  test('-ed stripping (walked → walk)', () => {
    expect(fallbacks('walked')).toContain('walk');
  });

  test('-ed doubled consonant (planned → plan)', () => {
    expect(fallbacks('planned')).toContain('plan');
  });

  test('-ing stripping (looking → look)', () => {
    expect(fallbacks('looking')).toContain('look');
  });

  test('-ing doubled consonant (running → run)', () => {
    expect(fallbacks('running')).toContain('run');
  });

  test('-ing silent-e restoration (hoping → hope)', () => {
    expect(fallbacks('hoping')).toContain('hope');
  });

  test('produces no duplicates', () => {
    const result = fallbacks('running');
    expect(result.length).toBe(new Set(result).size);
  });

  test('short word (< 3 chars) does not produce invalid candidates', () => {
    const result = fallbacks('is');
    expect(result).toContain('is');
    // Should not crash or produce empty strings
    result.forEach((c) => expect(c.length).toBeGreaterThan(0));
  });
});
