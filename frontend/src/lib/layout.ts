// The two-panel layout (build-plan §2, §7): the focused side takes 2/3, the
// other 1/3 and is veiled, so the tester only sees what that role would know.
// Both shows the two sides at half width.

export type Focus = 'customer' | 'both' | 'dave';
export type Width = 'wide' | 'half' | 'narrow';

export interface PanelLayout {
  customer: Width;
  dave: Width;
  veiled: 'customer' | 'dave' | undefined;
}

export function panelLayout(focus: Focus): PanelLayout {
  if (focus === 'customer') return { customer: 'wide', dave: 'narrow', veiled: 'dave' };
  if (focus === 'dave') return { customer: 'narrow', dave: 'wide', veiled: 'customer' };
  return { customer: 'half', dave: 'half', veiled: undefined };
}
