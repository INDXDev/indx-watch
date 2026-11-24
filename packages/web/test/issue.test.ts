import { describe, expect, it } from 'vitest';
import { issueLabel, webLinks } from '../src/issue';

describe('issue links', () => {
  it('labels a GitHub issue URL by its number, anything else by its host', () => {
    expect(issueLabel('https://github.com/shop-co/shop/issues/42')).toBe('#42');
    expect(issueLabel('https://github.com/shop-co/shop/issues/42#issuecomment-1')).toBe('#42');
    expect(issueLabel('https://tracker.shop.test/T-7')).toBe('tracker.shop.test');
  });
  it('renders web URLs only', () => {
    const links = ['https://github.com/a/b/issues/1', 'javascript:alert(1)', 'file:///etc/passwd'];
    expect(webLinks(links)).toEqual(['https://github.com/a/b/issues/1']);
    expect(webLinks(undefined)).toEqual([]);
  });
});
