import { describe, it, expect } from 'vitest';
import { getSiteKey, resolveSiteActivation } from '../utils/storage';

describe('getSiteKey', () => {
  it('treats www and the bare host as one site', () => {
    expect(getSiteKey('www.vlr.gg')).toBe('vlr.gg');
    expect(getSiteKey('VLR.GG')).toBe('vlr.gg');
  });

  it('leaves other subdomains alone', () => {
    expect(getSiteKey('music.youtube.com')).toBe('music.youtube.com');
  });
});

describe('resolveSiteActivation', () => {
  it('stays off by default on an ordinary site', () => {
    expect(resolveSiteActivation('vlr.gg', {})).toEqual({ active: false });
  });

  it('turns on once the user opts in', () => {
    expect(resolveSiteActivation('www.vlr.gg', { 'vlr.gg': true })).toEqual({ active: true });
  });

  it('stays off if the user explicitly opted out', () => {
    expect(resolveSiteActivation('vlr.gg', { 'vlr.gg': false })).toEqual({ active: false });
  });

  it('keys overrides off the www-stripped host', () => {
    expect(resolveSiteActivation('www.vlr.gg', { 'vlr.gg': true }).active).toBe(true);
  });
});
