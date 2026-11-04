import { describe, expect, it } from 'vitest';
import { customerConversationUrl, daveConversationUrl, newCustomerPhone } from './conversation.ts';

describe('conversation urls (build-plan §3)', () => {
  it('addresses the customer conversation on the lawn-desk agent', () => {
    expect(customerConversationUrl('v123', 3, '+15550101')).toBe('/api/agents/lawn-desk/v123:3:+15550101');
  });

  it('addresses the Dave conversation of the same generation on the dave-phone agent', () => {
    expect(daveConversationUrl('v123', 3)).toBe('/api/agents/dave-phone/v123:3:dave');
  });
});

describe('newCustomerPhone', () => {
  it('builds an E.164 +1555 number with seven digits from the random source', () => {
    expect(newCustomerPhone(() => 0.0123456)).toBe('+15550123456');
    expect(newCustomerPhone(() => 0)).toBe('+15550000000');
    expect(newCustomerPhone(() => 0.9999999999)).toBe('+15559999999');
    expect(newCustomerPhone()).toMatch(/^\+1555\d{7}$/);
  });

  it('draws again when the number is already taken', () => {
    const draws = [0.1, 0.1, 0.2];
    expect(newCustomerPhone(() => draws.shift()!, ['+15551000000'])).toBe('+15552000000');
  });
});
