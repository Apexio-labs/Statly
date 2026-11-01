/**
 * Plain numbers with no dependency on zod. The phone card imports them from here, because the
 * package's main entry would bring the whole contract along into every card.
 */
export const gridColumns = 12;

/**
 * Every device uses the same cell size and only the number of columns differs. So a widget's
 * limits and its arrangements for certain sizes mean the same on all of them.
 */
export const deviceColumns = { tablet: 8, phone: 4 } as const;
export const deviceKinds = ["tablet", "phone"] as const;
export type DeviceKind = (typeof deviceKinds)[number];

export const widgetSizeLimits = { minW: 2, maxW: 12, minH: 2, maxH: 16 } as const;
