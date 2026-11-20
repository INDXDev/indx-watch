import { describe, expect, it } from 'vitest';
import { fakeBrowserProvider, fakeLlmClient } from '../src/index.js';
import { browserProviderContract, llmClientContract } from './contract.js';

const shop = {
  'https://shop.test/': { title: 'Shop', tree: 'link "Cart" [e1]' },
  'https://shop.test/cart': { title: 'Cart', tree: 'heading "Cart" [e1]\ntext "Total: $90"' },
};

browserProviderContract('fake', async () => ({
  provider: fakeBrowserProvider(shop),
  baseUrl: 'https://shop.test',
}));
llmClientContract('fake', async () => fakeLlmClient());

describe('execution fakes', () => {
  it('fakeBrowserProvider records actions; fakeLlmClient judges by the expected text or a custom answer', async () => {
    const browser = fakeBrowserProvider(shop);
    const s = await browser.open({ baseUrl: 'https://shop.test/' });
    await s.act({ type: 'fill', ref: 'e2', value: 'SUMMER10' });
    expect(browser.actions).toEqual([{ type: 'fill', ref: 'e2', value: 'SUMMER10' }]);
    const observation = await s.observe();
    const llm = fakeLlmClient();
    expect(await llm.judge({ rubric: [], expected: 'Cart', observation })).toMatchObject({ verdict: 'pass' });
    expect(await llm.judge({ rubric: [], expected: 'Total', observation })).toMatchObject({
      verdict: 'fail',
    });
    expect(llm.calls).toHaveLength(2);
    const unsure = fakeLlmClient(() => ({ verdict: 'unknown', confidence: 0.4 }));
    expect(await unsure.judge({ rubric: [], expected: 'Cart', observation })).toMatchObject({
      verdict: 'unknown',
      confidence: 0.4,
      model: 'fake',
    });
  });
});
