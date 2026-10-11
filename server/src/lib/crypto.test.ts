import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hint, setSecretForTests } from './crypto.js';

setSecretForTests('test-secret-that-is-long-enough');

describe('crypto', () => {
  it('round-trips and never stores the plain text', () => {
    const enc = encrypt('sk-ant-secret-value');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('secret-value');
    expect(decrypt(enc)).toBe('sk-ant-secret-value');
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('detects tampering', () => {
    const enc = encrypt('value');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('hints with the last four characters', () => {
    expect(hint('gsk_abcdef1234')).toBe('••••1234');
    expect(hint(undefined)).toBeNull();
  });
});
