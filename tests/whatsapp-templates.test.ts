import { describe, expect, it } from 'vitest';
import { renderTemplate, sampleFields } from '@/lib/whatsapp/templates';

describe('renderTemplate', () => {
  it('fills every known placeholder it has a value for', () => {
    const r = renderTemplate('Hi {{firstName}}, is {{business}} in {{city}} still looking for {{category}} help?', {
      firstName: 'Priya',
      business: 'Priya Dental',
      city: 'Delhi',
      category: 'dental marketing',
    });
    expect(r.text).toBe('Hi Priya, is Priya Dental in Delhi still looking for dental marketing help?');
    expect(r.missing).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it('leaves a missing value as the placeholder instead of blanking or guessing it', () => {
    const r = renderTemplate('Hi {{firstName}}, from {{business}}', { firstName: 'Priya', business: null });
    expect(r.text).toBe('Hi Priya, from {{business}}');
    expect(r.missing).toEqual(['business']);
  });

  it('flags a placeholder that is not a known field at all', () => {
    const r = renderTemplate('Hi {{firstName}}, {{surname}}', { firstName: 'Priya' });
    expect(r.text).toBe('Hi Priya, {{surname}}');
    expect(r.unknown).toEqual(['surname']);
  });

  it('is a no-op on plain text with no placeholders', () => {
    const r = renderTemplate('Just a normal message.', {});
    expect(r).toEqual({ text: 'Just a normal message.', missing: [], unknown: [] });
  });
});

describe('sampleFields', () => {
  it('derives firstName from the first word of the lead name', () => {
    expect(sampleFields({ name: 'Priya Sharma', city: 'Delhi', category: 'Dental', phone: '919871530594' })).toMatchObject({
      firstName: 'Priya',
      name: 'Priya Sharma',
      business: 'Priya Sharma',
      city: 'Delhi',
      category: 'Dental',
    });
  });

  it('formats the phone and leaves missing fields null rather than empty strings', () => {
    const f = sampleFields({ name: null, city: null, category: null, phone: '919871530594' });
    expect(f.firstName).toBeNull();
    expect(f.name).toBeNull();
    expect(f.phone).toBe('+91 98715 30594');
  });
});
