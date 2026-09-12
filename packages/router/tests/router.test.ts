import { describe, expect, it } from 'vitest';
import { createRouter } from '../src/index.js';

const router = createRouter([
  {
    name: 'home',
    path: '/:locale?',
    validate: {
      locale: (value: string) => ['en', 'de', 'uk', 'zh'].includes(value),
    },
  },
  { name: 'company', path: '/company' },
  { name: 'localizedCompany', path: '/:locale/company' },
  { name: 'serviceIndex', path: '/services' },
  { name: 'localizedServiceIndex', path: '/:locale?/services' },
  { name: 'service', path: '/:locale?/services/:service' },
  { name: 'asset', path: '/assets/*file' },
] as const);

describe('isomorphic route matching', () => {
  it('prefers static routes and resolves optional locale segments', () => {
    expect(router.match('/')?.name).toBe('home');
    expect(router.match('/company')?.name).toBe('company');
    expect(router.match('/services')?.name).toBe('serviceIndex');
    expect(router.match('/de/services')?.name).toBe('localizedServiceIndex');
    expect(router.match('/uk/company')).toEqual({
      name: 'localizedCompany',
      path: '/:locale/company',
      params: { locale: 'uk' },
    });
    expect(router.match('/services/audit')?.params).toEqual({
      service: 'audit',
    });
    expect(router.match('/zh/services/audit/')?.params).toEqual({
      locale: 'zh',
      service: 'audit',
    });
  });

  it('builds encoded links and matches rest paths', () => {
    expect(router.href('home')).toBe('/');
    expect(router.href('service', { locale: 'de', service: 'AI audit' })).toBe(
      '/de/services/AI%20audit',
    );
    expect(router.match('/assets/docs/one.pdf')?.params).toEqual({
      file: 'docs/one.pdf',
    });
  });

  it('rejects malformed or unsafe inputs', () => {
    expect(router.match('/services/%2F')).toBeNull();
    expect(router.match('/services/%ZZ')).toBeNull();
    expect(router.match('/missing')).toBeNull();
    expect(() => router.href('home', { locale: 'missing' })).toThrow(
      'validation',
    );
    expect(() => router.href('service', { service: '..' })).toThrow(
      'Invalid value',
    );
    expect(() => router.href('company', { locale: 'en' })).toThrow(
      'Unexpected',
    );
  });

  it('rejects duplicate or malformed route definitions', () => {
    expect(() =>
      createRouter([
        { name: 'one', path: '/:first' },
        { name: 'two', path: '/:second' },
      ]),
    ).toThrow('Duplicate route');
    expect(() =>
      createRouter([{ name: 'bad', path: '/files/*rest/more' }]),
    ).toThrow('Rest parameter must be final');
  });
});
