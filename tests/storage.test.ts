import { describe, it, expect } from 'vitest';
import { getSiteKey, isDefaultOffHost, resolveSiteActivation } from '../utils/storage';

describe('getSiteKey', () => {
  it('treats www and the bare host as one site', () => {
    expect(getSiteKey('www.vlr.gg')).toBe('vlr.gg');
    expect(getSiteKey('VLR.GG')).toBe('vlr.gg');
  });

  it('leaves other subdomains alone', () => {
    expect(getSiteKey('music.youtube.com')).toBe('music.youtube.com');
  });
});

describe('isDefaultOffHost', () => {
  it.each(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])(
    'covers %s via subdomain matching',
    (host) => {
      expect(isDefaultOffHost(host)).toBe(true);
    },
  );

  it('does not match a host that merely ends with the same letters', () => {
    expect(isDefaultOffHost('notyoutube.com')).toBe(false);
    expect(isDefaultOffHost('youtube.com.evil.test')).toBe(false);
  });

  it('leaves ordinary sites on', () => {
    expect(isDefaultOffHost('vlr.gg')).toBe(false);
    expect(isDefaultOffHost('en.wikipedia.org')).toBe(false);
  });
});

describe('resolveSiteActivation', () => {
  it('runs by default on an ordinary site', () => {
    expect(resolveSiteActivation('vlr.gg', {})).toEqual({ active: true, byDefault: false });
  });

  it('stays off on a site that ships disabled, and says so', () => {
    expect(resolveSiteActivation('www.youtube.com', {})).toEqual({
      active: false,
      byDefault: true,
    });
  });

  it('lets the user switch a default-off site back on', () => {
    expect(resolveSiteActivation('www.youtube.com', { 'youtube.com': true })).toEqual({
      active: true,
      byDefault: false,
    });
  });

  it('lets the user switch an ordinary site off', () => {
    expect(resolveSiteActivation('vlr.gg', { 'vlr.gg': false })).toEqual({
      active: false,
      byDefault: false,
    });
  });

  it('keys overrides off the www-stripped host', () => {
    expect(resolveSiteActivation('www.vlr.gg', { 'vlr.gg': false }).active).toBe(false);
  });
});
